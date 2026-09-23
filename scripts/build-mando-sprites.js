#!/usr/bin/env node
// Builds the small Mando animation assets from the Mando-assets-v6 pack
// (384x416 PNG frame sequences, ~78MB, kept out of git):
//
//   src/assets/mando/<action>.webp          single-row spritesheet the app
//                                            animates with CSS steps()
//   src/whisperwoof/ui/indicator/mando-manifest.json
//   website/mando/sprites/<action>.webp     same sheets for the site demo
//   website/mando/<action>.webp             animated WebP for the README
//
//   node scripts/build-mando-sprites.js [path/to/Mando-assets-v6]
//
// Requires ffmpeg, cwebp and img2webp on PATH (brew install ffmpeg webp).
// Everything is built into a temp dir first and only copied into the repo
// once every action succeeded, so sheets and manifest can never disagree.

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.resolve(process.argv[2] || path.join(REPO_ROOT, "Mando-assets-v6"));
const APP_SHEET_DIR = path.join(REPO_ROOT, "src", "assets", "mando");
const MANIFEST_PATH = path.join(REPO_ROOT, "src", "whisperwoof", "ui", "indicator", "mando-manifest.json");
const SITE_DIR = path.join(REPO_ROOT, "website", "mando");
const SITE_SHEET_DIR = path.join(SITE_DIR, "sprites");
// The website shows Mando at ~240px, so it gets full-resolution loops too
// (the 120px ones stay for the README, where file size matters more).
const SITE_HD_DIR = path.join(SITE_DIR, "hd");

// Actions the app actually uses. Cell size keeps the source 12:13 aspect and
// is 2x the CSS size so it stays crisp on Retina.
const ACTIONS = ["wait", "think", "review", "hop"];
// Website-only HD loops (the scroll-along companion runs; the download CTA waves).
const SITE_ONLY_ACTIONS = ["run-right", "run-left", "wave"];
const CELL_WIDTH = 120;
const CELL_HEIGHT = 130;
// Every other source frame: the pack interpolates 3-6 key poses to 25fps, so
// 12.5fps at 60px on screen looks identical and halves the sheet width.
const FRAME_STEP = 2;
const WEBP_QUALITY = 88;

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`${cmd} not found on PATH — install it (brew install ${cmd === "ffmpeg" ? "ffmpeg" : "webp"})`);
    }
    throw new Error(`${cmd} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const why = result.signal ? `killed by ${result.signal}` : `exit ${result.status}`;
    throw new Error(`${cmd} ${args.join(" ")} (${why})\n${result.stderr ? result.stderr.toString() : ""}`);
  }
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

/** Validate the fields we feed to ffmpeg and ship in the manifest. */
function validateEntry(entry) {
  if (!isPositiveInt(entry.frameDurationMs) || !isPositiveInt(entry.frameCount) || !Number.isInteger(entry.startNumber)) {
    throw new Error(`Action "${entry.id}": frameCount, frameDurationMs and startNumber must be integers`);
  }
  if (typeof entry.frames !== "string" || !entry.frames.includes("%") || entry.frames.includes("..")) {
    throw new Error(`Action "${entry.id}": frames must be a printf-style pattern inside the pack, got ${JSON.stringify(entry.frames)}`);
  }
  const resolved = path.resolve(SOURCE_DIR, entry.frames);
  if (!resolved.startsWith(SOURCE_DIR + path.sep)) {
    throw new Error(`Action "${entry.id}": frames pattern escapes ${SOURCE_DIR}`);
  }
  return resolved;
}

function readSourceManifest() {
  const file = path.join(SOURCE_DIR, "animations.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No animations.json in ${SOURCE_DIR}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listPngFrames(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
}

/** Downscale every step-th source frame into tmpDir/<id><suffix>/NNN.png. */
function extractFrames(
  entry,
  framesPattern,
  tmpDir,
  { width = CELL_WIDTH, height = CELL_HEIGHT, suffix = "", step = FRAME_STEP } = {}
) {
  const framesDir = path.join(tmpDir, `${entry.id}${suffix}`);
  fs.mkdirSync(framesDir);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-start_number", String(entry.startNumber),
    "-i", framesPattern,
    "-vf", `select=not(mod(n\\,${step})),scale=${width}:${height}:flags=lanczos`,
    "-fps_mode", "passthrough",
    "-pix_fmt", "rgba",
    path.join(framesDir, "%03d.png"),
  ]);
  return framesDir;
}

function buildSheet(entry, framesDir, frameCount, tmpDir) {
  const sheetPng = path.join(tmpDir, `${entry.id}-sheet.png`);
  const sheetWebp = path.join(tmpDir, `${entry.id}.webp`);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", path.join(framesDir, "%03d.png"),
    "-vf", `tile=${frameCount}x1`,
    "-frames:v", "1",
    "-pix_fmt", "rgba",
    sheetPng,
  ]);
  run("cwebp", ["-quiet", "-q", String(WEBP_QUALITY), "-alpha_q", "100", "-exact", sheetPng, "-o", sheetWebp]);
  return sheetWebp;
}

function buildAnimatedWebp(entry, framesDir, frames, frameDurationMs, tmpDir, suffix = "") {
  const out = path.join(tmpDir, `${entry.id}${suffix}-animated.webp`);
  run("img2webp", [
    "-loop", "0", "-lossy", "-q", String(WEBP_QUALITY), "-d", String(frameDurationMs),
    ...frames.map((f) => path.join(framesDir, f)),
    "-o", out,
  ]);
  return out;
}

function buildAction(entry, tmpDir) {
  const framesPattern = validateEntry(entry);
  const framesDir = extractFrames(entry, framesPattern, tmpDir);
  const frames = listPngFrames(framesDir);
  const expected = Math.ceil(entry.frameCount / FRAME_STEP);
  if (frames.length !== expected) {
    throw new Error(`Action "${entry.id}": expected ${expected} frames after decimation, ffmpeg produced ${frames.length}`);
  }
  const frameDurationMs = entry.frameDurationMs * FRAME_STEP;
  const hdDir = extractFrames(entry, framesPattern, tmpDir, {
    width: entry.width,
    height: entry.height,
    suffix: "-hd",
  });
  return {
    id: entry.id,
    frameCount: frames.length,
    frameDurationMs,
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    sheet: buildSheet(entry, framesDir, frames.length, tmpDir),
    animated: buildAnimatedWebp(entry, framesDir, frames, frameDurationMs, tmpDir),
    animatedHd: buildAnimatedWebp(entry, hdDir, listPngFrames(hdDir), frameDurationMs, tmpDir, "-hd"),
  };
}

/** Full-resolution loop only, for the website. Short loops (runs: 4 frames) keep every frame. */
function buildSiteOnlyAction(entry, tmpDir) {
  const framesPattern = validateEntry(entry);
  const step = entry.frameCount <= 8 ? 1 : FRAME_STEP;
  const dir = extractFrames(entry, framesPattern, tmpDir, {
    width: entry.width,
    height: entry.height,
    suffix: "-hd",
    step,
  });
  return {
    id: entry.id,
    animatedHd: buildAnimatedWebp(entry, dir, listPngFrames(dir), entry.frameDurationMs * step, tmpDir, "-hd"),
  };
}

/** Copy every finished asset into the repo and write the manifest, all at once. */
function publish(built, siteOnly) {
  [APP_SHEET_DIR, SITE_SHEET_DIR, SITE_HD_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  built.forEach(({ id, sheet, animated, animatedHd }) => {
    fs.copyFileSync(animatedHd, path.join(SITE_HD_DIR, `${id}.webp`));
    fs.copyFileSync(sheet, path.join(APP_SHEET_DIR, `${id}.webp`));
    fs.copyFileSync(sheet, path.join(SITE_SHEET_DIR, `${id}.webp`));
    fs.copyFileSync(animated, path.join(SITE_DIR, `${id}.webp`));
  });
  siteOnly.forEach(({ id, animatedHd }) => fs.copyFileSync(animatedHd, path.join(SITE_HD_DIR, `${id}.webp`)));
  const manifest = Object.fromEntries(
    built.map(({ id, frameCount, frameDurationMs, cellWidth, cellHeight }) => [
      id,
      { frameCount, frameDurationMs, cellWidth, cellHeight },
    ])
  );
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function report(built) {
  built.forEach(({ id, frameCount, sheet, animated, animatedHd }) => {
    const kb = (file) => (fs.statSync(file).size / 1024).toFixed(0).padStart(3);
    console.log(`${id.padEnd(7)} ${String(frameCount).padStart(2)} frames  sheet ${kb(sheet)} KB  animated ${kb(animated)} KB  hd ${kb(animatedHd)} KB`);
  });
  console.log(`\nWrote sheets to ${path.relative(REPO_ROOT, APP_SHEET_DIR)} + ${path.relative(REPO_ROOT, SITE_SHEET_DIR)}, animations to ${path.relative(REPO_ROOT, SITE_DIR)}`);
}

function main() {
  const source = readSourceManifest();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mando-sprites-"));
  try {
    const built = ACTIONS.map((id) => {
      const entry = source.animations.find((a) => a.id === id);
      if (!entry) throw new Error(`Action "${id}" missing from animations.json`);
      return buildAction(entry, tmpDir);
    });
    const siteOnly = SITE_ONLY_ACTIONS.map((id) => {
      const entry = source.animations.find((a) => a.id === id);
      if (!entry) throw new Error(`Action "${id}" missing from animations.json`);
      return buildSiteOnlyAction(entry, tmpDir);
    });
    report(built);
    siteOnly.forEach(({ id, animatedHd }) =>
      console.log(`${id.padEnd(9)} site hd ${(fs.statSync(animatedHd).size / 1024).toFixed(0)} KB`)
    );
    publish(built, siteOnly);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
