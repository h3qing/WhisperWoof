#!/usr/bin/env node
// Builds the app icon files from src/assets/logo.svg (the Mando head on its
// background, drawn to Apple's 824-on-1024 icon grid):
//
//   src/assets/icon.png    1024px, also the Linux icon and the tray fallback
//   src/assets/icon.icns   macOS (16px to 1024px, 1x and 2x)
//   src/assets/icon.ico    Windows (16px to 256px, PNG-compressed entries)
//
//   node scripts/build-app-icon.js
//
// macOS only: renders the SVG with headless Google Chrome (override the path
// with CHROME=/path/to/chrome) and uses sips + iconutil for the sizes.

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const REPO_ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(REPO_ROOT, "src", "assets");
const SOURCE = path.join(ASSETS, "logo.svg");
const CHROME =
  process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ICNS_SIZES = [16, 32, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed: ${result.stderr?.toString().trim() || result.error}`);
  }
}

function resize(src, size, dest) {
  run("sips", ["-z", String(size), String(size), src, "--out", dest]);
}

// ICO files may hold PNG data directly (Vista and later), so no bitmap
// encoding is needed: a 6-byte header, one 16-byte entry per size, then PNGs.
function buildIco(pngPaths) {
  const images = pngPaths.map(({ size, file }) => ({ size, data: fs.readFileSync(file) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function pngSize(file) {
  const header = fs.readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

function build(work) {
  const master = path.join(work, "icon-1024.png");
  run(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    "--force-device-scale-factor=1",
    "--window-size=1024,1024",
    `--screenshot=${master}`,
    pathToFileURL(SOURCE).href,
  ]);
  const { width, height } = pngSize(master);
  if (width !== 1024 || height !== 1024) {
    throw new Error(`Chrome rendered ${width}x${height}, expected 1024x1024`);
  }

  const iconset = path.join(work, "icon.iconset");
  fs.mkdirSync(iconset);
  for (const size of ICNS_SIZES) {
    resize(master, size, path.join(iconset, `icon_${size}x${size}.png`));
    resize(master, size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  run("iconutil", ["-c", "icns", iconset, "-o", path.join(work, "icon.icns")]);

  const icoPngs = ICO_SIZES.map((size) => {
    const file = path.join(work, `ico-${size}.png`);
    resize(master, size, file);
    return { size, file };
  });
  fs.writeFileSync(path.join(work, "icon.ico"), buildIco(icoPngs));

  fs.copyFileSync(master, path.join(ASSETS, "icon.png"));
  fs.copyFileSync(path.join(work, "icon.icns"), path.join(ASSETS, "icon.icns"));
  fs.copyFileSync(path.join(work, "icon.ico"), path.join(ASSETS, "icon.ico"));
  console.log("Wrote src/assets/icon.png, icon.icns and icon.ico");
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ww-icon-"));
try {
  build(work);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
