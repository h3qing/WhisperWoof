/**
 * The real WhisperServerManager / LlamaServerManager spawn logic, run against
 * tiny stand-in servers that behave like the bundled binaries' auth surface:
 *
 * - llama-server reads its key from LLAMA_API_KEY and refuses every route
 *   but /health without `Authorization: Bearer <key>` (llama.cpp
 *   tools/server/server-http.cpp).
 * - whisper-server registers /health, /inference and /load only under
 *   `--request-path` (OpenWhispr/whisper.cpp examples/server/server.cpp).
 *
 * - sherpa-onnx's WebSocket servers (Parakeet, live dictation, meetings)
 *   print "Listening on:" when ready.
 *
 * Checks: hardening flags, the key never in argv, secrets stripped from the
 * sidecar env, and every app request carrying the key / prefix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const LlamaServerManager = require("../../../helpers/llamaServer.js");
const WhisperServerManager = require("../../../helpers/whisperServer.js");
const ParakeetWsServer = require("../../../helpers/parakeetWsServer.js");

const FAKE_COMMON = `
const http = require("http");
const fs = require("fs");
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
fs.writeFileSync(
  process.env.WW_FAKE_REPORT,
  JSON.stringify({ args, envNames: Object.keys(process.env), llamaKey: process.env.LLAMA_API_KEY || null })
);
const readBody = (req, cb) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => cb(b)); };
`;

const FAKE_LLAMA = `${FAKE_COMMON}
const key = process.env.LLAMA_API_KEY;
http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  if (!key || req.headers.authorization !== "Bearer " + key) { res.writeHead(401); res.end('{"error":"Invalid API Key"}'); return; }
  readBody(req, () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: " polished " } }] }));
  });
}).listen(Number(arg("--port")), arg("--host"));
`;

const FAKE_WHISPER = `${FAKE_COMMON}
const prefix = arg("--request-path");
http.createServer((req, res) => {
  if (req.method === "GET" && req.url === prefix + "/health") { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  if (req.method === "POST" && req.url === prefix + "/inference") {
    readBody(req, () => { res.writeHead(200); res.end('{"text":"hello"}'); });
    return;
  }
  req.resume();
  res.writeHead(404);
  res.end("File Not Found (" + req.url + ")");
}).listen(Number(arg("--port")), arg("--host"));
`;

const FAKE_SHERPA = `${FAKE_COMMON}
process.stderr.write("Listening on: 127.0.0.1:" + (args.find((a) => a.startsWith("--port=")) || "").slice(7) + "\\n");
setInterval(() => {}, 1000);
`;

function writeFake(dir: string, name: string, body: string) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return file;
}

function get(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe.runIf(process.platform !== "win32")("loopback model servers", () => {
  let dir = "";
  let modelPath = "";
  let report = "";
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-servers-"));
    modelPath = path.join(dir, "model.bin");
    fs.writeFileSync(modelPath, "not a real model");
    report = path.join(dir, "report.json");
    for (const name of ["WW_FAKE_REPORT", "OPENAI_API_KEY", "GITHUB_TOKEN", "LLAMA_API_KEY"]) {
      saved[name] = process.env[name];
    }
    process.env.WW_FAKE_REPORT = report;
    process.env.OPENAI_API_KEY = "sk-should-not-leak";
    process.env.GITHUB_TOKEN = "ghp-should-not-leak";
    process.env.LLAMA_API_KEY = "users-own-key";
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("llama-server: per-process key via env, hardening flags, Bearer on requests", async () => {
    const fake = writeFake(dir, "fake-llama-server", FAKE_LLAMA);
    const mgr = new LlamaServerManager();
    mgr.getServerBinaryPaths = () => ({ default: fake, cpu: fake });
    try {
      await mgr.start(modelPath, { threads: 2 });
      const seen = JSON.parse(fs.readFileSync(report, "utf8"));

      expect(mgr.apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(mgr.getApiKey()).toBe(mgr.apiKey);
      // Key reaches the server through the environment only — argv is
      // readable by other local users via ps.
      expect(seen.llamaKey).toBe(mgr.apiKey);
      expect(seen.args.join(" ")).not.toContain(mgr.apiKey);
      expect(seen.args).toEqual(expect.arrayContaining(["--jinja", "--no-webui", "--no-slots"]));
      expect(seen.args[seen.args.indexOf("--host") + 1]).toBe("127.0.0.1");
      expect(seen.envNames).not.toContain("OPENAI_API_KEY");
      expect(seen.envNames).not.toContain("GITHUB_TOKEN");

      // The app's own request carries the key; one without it is refused.
      await expect(mgr.inference([{ role: "user", content: "hi" }])).resolves.toBe("polished");
      expect(await get(mgr.port, "/v1/chat/completions")).toBe(401);
      expect(await get(mgr.port, "/health")).toBe(200);
      expect(await mgr.checkHealth()).toBe(true);
    } finally {
      await mgr.stop();
    }
    expect(mgr.getApiKey()).toBeNull();
    expect(mgr.apiKey).toBeNull();
  }, 20000);

  it("llama-server: a restart gets a new key", async () => {
    const fake = writeFake(dir, "fake-llama-server-2", FAKE_LLAMA);
    const mgr = new LlamaServerManager();
    mgr.getServerBinaryPaths = () => ({ default: fake, cpu: fake });
    try {
      await mgr.start(modelPath);
      const first = mgr.apiKey;
      await mgr.stop();
      await mgr.start(modelPath);
      expect(mgr.apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(mgr.apiKey).not.toBe(first);
      await expect(mgr.inference([{ role: "user", content: "hi" }])).resolves.toBe("polished");
    } finally {
      await mgr.stop();
    }
  }, 20000);

  it("whisper-server: random --request-path, used by health checks and /inference", async () => {
    const fake = writeFake(dir, "fake-whisper-server", FAKE_WHISPER);
    const mgr = new WhisperServerManager();
    mgr.getServerBinaryPath = () => fake;
    try {
      await mgr.start(modelPath, { language: "en" });
      const seen = JSON.parse(fs.readFileSync(report, "utf8"));

      expect(mgr.requestPath).toMatch(/^\/ww-[0-9a-f]{32}$/);
      expect(seen.args[seen.args.indexOf("--request-path") + 1]).toBe(mgr.requestPath);
      expect(seen.args[seen.args.indexOf("--host") + 1]).toBe("127.0.0.1");
      expect(seen.envNames).not.toContain("OPENAI_API_KEY");
      expect(seen.envNames).not.toContain("GITHUB_TOKEN");
      expect(seen.envNames).not.toContain("LLAMA_API_KEY");

      // Without the prefix nothing answers — a web page can't guess it.
      expect(await get(mgr.port, "/inference")).toBe(404);
      expect(await get(mgr.port, "/health")).toBe(404);
      expect(await mgr.checkHealth()).toBe(true);

      mgr.canConvert = true;
      mgr._convertToWav = async (buf: Buffer) => buf;
      await expect(mgr.transcribe(Buffer.from("RIFF0000WAVE"), { language: "en" })).resolves.toEqual({
        text: "hello",
      });
    } finally {
      await mgr.stop();
      mgr._clearIdleTimer();
    }
    expect(mgr.requestPath).toBeNull();
  }, 20000);

  it("sherpa-onnx servers (dictation, live, meetings) get no API keys", async () => {
    const fake = writeFake(dir, "fake-sherpa-onnx-ws", FAKE_SHERPA);
    const modelDir = fs.mkdtempSync(path.join(dir, "model-"));
    const server = new ParakeetWsServer({ pidKey: "parakeet-test" });
    server.getWsBinaryPath = () => fake;
    server._warmUp = async () => {};
    try {
      await server.start("parakeet-tdt-0.6b-v3", modelDir, "offline");
      const seen = JSON.parse(fs.readFileSync(report, "utf8"));
      expect(seen.envNames).not.toContain("OPENAI_API_KEY");
      expect(seen.envNames).not.toContain("GITHUB_TOKEN");
      expect(seen.envNames).toContain("PATH");
    } finally {
      await server.stop();
    }
  }, 20000);
});
