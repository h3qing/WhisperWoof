#!/usr/bin/env node
/**
 * Local page for rating real dictations blind: hear the clip, pick the
 * transcript closest to what you said, fix it into what you actually said.
 * The fixed text becomes the reference that score.js measures every engine
 * against.
 *
 *   node eval/real-dictation/rate_server.js --data ~/.whisperwoof-bench/dictation-real-1 [--port 8765]
 *
 * Listens on 127.0.0.1 only. Audio, transcripts and ratings stay in --data.
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { tokenize } = require("../meeting-bench/run_clips");
const { score, loadSession } = require("./score");
const { polishSession, savePolishRating, scorePolish } = require("./polish_score");

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const DATA = path.resolve(String(arg("data", "")).replace(/^~/, os.homedir()));
const PORT = Number(arg("port", 8765));
const RATINGS = path.join(DATA, "ratings.json");
const PAGE = path.join(__dirname, "rate.html");

const readRatings = () => (fs.existsSync(RATINGS) ? JSON.parse(fs.readFileSync(RATINGS, "utf8")) : {});

/** Order that doesn't depend on which engine produced a text, stable per clip. */
const shuffleKey = (clipId, text) => crypto.createHash("sha1").update(`${clipId}:${text}`).digest("hex");

/** Outputs that differ only in punctuation, case or spacing are one option. */
function optionsFor(clip, engines) {
  const groups = new Map();
  for (const e of engines) {
    const hyp = e.clips[clip.id];
    if (!hyp) continue;
    const key = tokenize(hyp.text || "").join(" ");
    const group = groups.get(key) || { text: (hyp.text || "").trim(), engines: [] };
    groups.set(key, { ...group, engines: [...group.engines, e.engine] });
  }
  return [...groups.values()].sort((a, b) => shuffleKey(clip.id, a.text).localeCompare(shuffleKey(clip.id, b.text)));
}

function session() {
  const { manifest, engines } = loadSession(DATA);
  const clips = manifest.clips.map((clip) => {
    const options = optionsFor(clip, engines);
    return { id: clip.id, durationMs: clip.durationMs, timestamp: clip.timestamp, options, unanimous: options.length === 1 };
  });
  return { clips, ratings: readRatings(), engines: engines.length };
}

function results() {
  const { manifest, engines } = loadSession(DATA);
  const ratings = readRatings();
  const details = manifest.clips
    .filter((c) => ratings[c.id]?.reference && !ratings[c.id].skipped)
    .map((c) => ({ id: c.id, reference: ratings[c.id].reference, hyps: Object.fromEntries(engines.map((e) => [e.engine, e.clips[c.id]?.text ?? null])) }));
  return { ...score(DATA), details };
}

function saveRating(body) {
  const clipIds = new Set(loadSession(DATA).manifest.clips.map((c) => String(c.id)));
  const id = String(body.clipId);
  if (!clipIds.has(id)) throw new Error("unknown clip");
  const ratings = readRatings();
  const next = body.clear
    ? Object.fromEntries(Object.entries(ratings).filter(([k]) => k !== id))
    : {
        ...ratings,
        [id]: {
          reference: String(body.reference || "").slice(0, 5000),
          pickedEngines: Array.isArray(body.pickedEngines) ? body.pickedEngines.map(String) : [],
          skipped: body.skipped ? String(body.skipped) : false,
          seconds: Number(body.seconds) || null,
          at: new Date().toISOString(),
        },
      };
  fs.writeFileSync(RATINGS, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(PAGE));
    if (req.method === "GET" && url.pathname === "/api/session") return send(res, 200, "application/json", JSON.stringify(session()));
    if (req.method === "GET" && url.pathname === "/api/results") return send(res, 200, "application/json", JSON.stringify(results()));
    if (req.method === "GET" && url.pathname === "/api/polish") return send(res, 200, "application/json", JSON.stringify(polishSession(DATA, loadSession(DATA).manifest)));
    if (req.method === "GET" && url.pathname === "/api/polish-results") return send(res, 200, "application/json", JSON.stringify(scorePolish(DATA)));
    const audio = url.pathname.match(/^\/audio\/(\d+)\.wav$/);
    if (req.method === "GET" && audio) {
      const file = path.join(DATA, "audio", `${audio[1]}.wav`);
      if (!fs.existsSync(file)) return send(res, 404, "text/plain", "no such clip");
      return send(res, 200, "audio/wav", fs.readFileSync(file));
    }
    const saver = { "/api/rating": saveRating, "/api/polish-rating": (body) => savePolishRating(DATA, loadSession(DATA).manifest, body) }[url.pathname];
    if (req.method === "POST" && saver) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 100000) req.destroy();
      });
      req.on("end", () => {
        try {
          send(res, 200, "application/json", JSON.stringify(saver(JSON.parse(raw))));
        } catch (err) {
          send(res, 400, "text/plain", err.message);
        }
      });
      return;
    }
    send(res, 404, "text/plain", "not found");
  } catch (err) {
    send(res, 500, "text/plain", err.message);
  }
});

if (!fs.existsSync(path.join(DATA, "manifest.json"))) throw new Error(`no manifest.json in ${DATA}`);
server.listen(PORT, "127.0.0.1", () => console.log(`rating page on http://127.0.0.1:${PORT}`));
