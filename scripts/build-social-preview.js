#!/usr/bin/env node
// Builds the link preview people see when they share the site (Messages,
// Slack, X, Discord…) from website/social-preview.html:
//
//   website/social-preview.png   1200x630 still (og:image)
//   website/social-preview.mp4   the same card as a seamless loop (og:video;
//                                Messages downloads it and autoplays it muted)
//
//   node scripts/build-social-preview.js
//
// Drives headless Google Chrome over its DevTools pipe (override the path
// with CHROME=/path/to/chrome), calling the page's draw(t) for every frame,
// and encodes the loop with ffmpeg (brew install ffmpeg, or
// FFMPEG=/path/to/ffmpeg). The page is served from a local server because
// Chrome won't load fonts across file:// URLs.

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SITE = path.join(REPO_ROOT, "website");
const PAGE = "social-preview.html";
const CHROME =
  process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const WIDTH = 1200;
const HEIGHT = 630;
const FPS = 25;
const TYPES = {
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serveSite() {
  const server = http.createServer((req, res) => {
    const file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(SITE + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The loop length lives in the page, next to the motions that must divide it.
function readFrameCount() {
  const match = /const LOOP = ([\d.]+);/.exec(fs.readFileSync(path.join(SITE, PAGE), "utf8"));
  if (!match) throw new Error(`No "const LOOP = <seconds>;" in website/${PAGE}`);
  const frames = parseFloat(match[1]) * FPS;
  if (Math.abs(frames - Math.round(frames)) > 1e-6) {
    throw new Error(`LOOP (${match[1]}s) is not a whole number of frames at ${FPS}fps`);
  }
  return Math.round(frames);
}

// Minimal DevTools Protocol client over --remote-debugging-pipe: Chrome reads
// commands on fd 3 and writes replies on fd 4, each JSON message ending in \0.
function launchChrome(profile) {
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] }
  );
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  let buffered = "";
  let exited = null;

  const failAll = (err) => {
    exited = err;
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };
  child.on("error", (err) =>
    failAll(err.code === "ENOENT" ? new Error(`Chrome not found at ${CHROME} (set CHROME)`) : err)
  );
  child.on("exit", (code, signal) => failAll(new Error(`Chrome exited (${signal || `exit ${code}`})`)));

  child.stdio[4].on("data", (chunk) => {
    buffered += chunk;
    for (let end = buffered.indexOf("\0"); end !== -1; end = buffered.indexOf("\0")) {
      const msg = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        listeners.get(msg.method)?.(msg.params);
      }
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(exited);
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + "\0");
    });
  const once = (method) => new Promise((resolve) => listeners.set(method, resolve));
  return { child, send, once };
}

async function render(url, work) {
  const chrome = launchChrome(path.join(work, "profile"));
  const timeout = setTimeout(() => chrome.child.kill("SIGKILL"), 120_000);
  try {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => chrome.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const { exceptionDetails } = await page("Runtime.evaluate", { expression, awaitPromise: true });
      if (exceptionDetails) {
        throw new Error(`${expression}: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      }
    };
    const capture = async (file) => {
      await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const { data } = await page("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    };

    await page("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await page("Page.enable");
    const loaded = chrome.once("Page.loadEventFired");
    await page("Page.navigate", { url });
    await loaded;
    await evaluate("window.ready");

    // Without a #t the page draws its chosen still moment. The video starts
    // on that same moment, so Messages swaps the image for the video without
    // a jump.
    await capture(path.join(work, "still.png"));
    const frameCount = readFrameCount();
    for (let i = 0; i < frameCount; i++) {
      await evaluate(`draw(STILL + ${i / FPS})`);
      await capture(path.join(work, `frame-${String(i).padStart(3, "0")}.png`));
    }
    console.log(`Rendered ${frameCount} frames`);
    await chrome.send("Browser.close").catch(() => {});
  } finally {
    clearTimeout(timeout);
    const { child } = chrome;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited; // before the profile directory is removed
    }
  }
}

function encode(work, out) {
  // H.264 + yuv420p + faststart: what Messages (AVFoundation) plays inline.
  const args = [
    "-y", "-loglevel", "error",
    "-framerate", String(FPS),
    "-i", path.join(work, "frame-%03d.png"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an",
    out,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) =>
      reject(err.code === "ENOENT" ? new Error(`ffmpeg not found (brew install ffmpeg, or set FFMPEG)`) : err)
    );
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr.trim()}`))));
  });
}

async function build(work) {
  const server = await serveSite();
  try {
    await render(`http://127.0.0.1:${server.address().port}/${PAGE}`, work);
  } finally {
    server.close();
  }
  const video = path.join(work, "social-preview.mp4");
  await encode(work, video);

  fs.copyFileSync(path.join(work, "still.png"), path.join(SITE, "social-preview.png"));
  fs.copyFileSync(video, path.join(SITE, "social-preview.mp4"));
  const kb = (file) => Math.round(fs.statSync(path.join(SITE, file)).size / 1024);
  console.log(
    `Wrote website/social-preview.png (${kb("social-preview.png")} KB) and social-preview.mp4 (${kb("social-preview.mp4")} KB)`
  );
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ww-social-"));
build(work)
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(work, { recursive: true, force: true }));
