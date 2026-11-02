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
 * - The speech llama-server (Qwen3-ASR, qwenAsr.js) is a second llama-server
 *   with --mmproj; it answers "language Chinese<asr_text>…".
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
const QwenAsrManager = require("../../../helpers/qwenAsr.js");
const { pcmToWav } = require("../../../helpers/ffmpegUtils.js");

// 16 kHz mono WAV: 200 ms syllables and 100 ms pauses, or a steady hiss.
function wav(seconds: number, speech: boolean) {
  const pcm = Buffer.alloc(seconds * 16000 * 2);
  for (let i = 0; i < seconds * 16000; i++) {
    const v = speech ? (i % 4800 < 3200 ? 0.2 * Math.sin(i / 3) : 0.001) : 0.03 * Math.sin(i * 12.9898);
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return pcmToWav(pcm);
}

const FAKE_COMMON = `
const http = require("http");
const fs = require("fs");
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
fs.writeFileSync(
  process.env.WW_FAKE_REPORT + (args.includes("--mmproj") ? ".asr" : ""),
  JSON.stringify({ args, envNames: Object.keys(process.env), llamaKey: process.env.LLAMA_API_KEY || null })
);
const readBody = (req, cb) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => cb(b)); };
`;

const FAKE_LLAMA = `${FAKE_COMMON}
const key = process.env.LLAMA_API_KEY;
http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  if (!key || req.headers.authorization !== "Bearer " + key) { res.writeHead(401); res.end('{"error":"Invalid API Key"}'); return; }
  readBody(req, (body) => {
    const audio = body.includes('"input_audio"');
    const hinted = audio && body.includes('"role":"system"');
    const content = hinted ? "language English<asr_text>hinted" : audio ? "language Chinese<asr_text>一共二十八个人" : " polished ";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
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
    for (const name of ["WW_FAKE_REPORT", "OPENAI_API_KEY", "GITHUB_TOKEN", "LLAMA_API_KEY", "LLAMA_ARG_TOOLS", "GGML_BACKEND_PATH"]) {
      saved[name] = process.env[name];
    }
    process.env.WW_FAKE_REPORT = report;
    process.env.OPENAI_API_KEY = "sk-should-not-leak";
    process.env.GITHUB_TOKEN = "ghp-should-not-leak";
    process.env.LLAMA_API_KEY = "users-own-key";
    // llama-server reads every option from LLAMA_ARG_* too; this one would
    // give any local page a shell.
    process.env.LLAMA_ARG_TOOLS = "all";
    process.env.GGML_BACKEND_PATH = "/tmp/evil-backend.dylib";
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
      await mgr.start(modelPath, { threads: 2, contextSize: 262144 });
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
      expect(seen.envNames).not.toContain("LLAMA_ARG_TOOLS");
      expect(seen.envNames).not.toContain("GGML_BACKEND_PATH");
      expect(seen.args).not.toContain("--mmproj");
      expect(seen.args).not.toContain("--cache-ram");
      // modelManagerBridge passes the model's full context length (262144 for
      // Qwen3.5 2B); llama.cpp fits the context itself, so it never becomes a flag.
      expect(seen.args).not.toContain("--ctx-size");

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

  it("llama-server: two starts at once run one server", async () => {
    const fake = writeFake(dir, "fake-llama-server-race", FAKE_LLAMA);
    const mgr = new LlamaServerManager();
    mgr.getServerBinaryPaths = () => ({ default: fake, cpu: fake });
    try {
      await mgr.start(modelPath);
      const first = mgr.process;
      mgr.ready = false; // health checks failed: the next start replaces it
      let starts = 0;
      const doStart = mgr._doStart.bind(mgr);
      mgr._doStart = (...args: unknown[]) => {
        starts++;
        return doStart(...args);
      };
      await Promise.all([mgr.start(modelPath), mgr.start(modelPath)]);
      expect(starts).toBe(1);
      expect(first.exitCode !== null || first.signalCode !== null).toBe(true);
      await expect(mgr.inference([{ role: "user", content: "hi" }])).resolves.toBe("polished");
    } finally {
      await mgr.stop();
    }
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

  it("speech llama-server: its own process, port range and key, next to the cleanup server", async () => {
    const fake = writeFake(dir, "fake-llama-server-asr", FAKE_LLAMA);
    const mmprojPath = path.join(dir, "mmproj.bin");
    fs.writeFileSync(mmprojPath, "not a real projector");
    const cleanup = new LlamaServerManager();
    cleanup.getServerBinaryPaths = () => ({ default: fake, cpu: fake });
    const asr = new QwenAsrManager();
    asr.server.getServerBinaryPaths = () => ({ default: fake, cpu: fake });
    asr.getModelFiles = () => [{ path: modelPath }, { path: mmprojPath }];
    asr.isModelDownloaded = () => true;
    const asrRequests = { count: 0 };
    const inference = asr.server.inference.bind(asr.server);
    asr.server.inference = (...args: unknown[]) => {
      asrRequests.count++;
      return inference(...args);
    };
    try {
      await cleanup.start(modelPath);
      await asr.startServer("qwen3-asr-1.7b");
      const seen = JSON.parse(fs.readFileSync(`${report}.asr`, "utf8"));

      const flag = (name: string) => seen.args[seen.args.indexOf(name) + 1];
      expect(flag("--mmproj")).toBe(mmprojPath);
      expect(flag("--ctx-size")).toBe("8192");
      expect(flag("--parallel")).toBe("1");
      expect(flag("--cache-ram")).toBe("0");
      expect(flag("--host")).toBe("127.0.0.1");
      expect(seen.args).toEqual(expect.arrayContaining(["--jinja", "--no-webui", "--no-slots"]));
      expect(Number(flag("--port"))).toBeGreaterThanOrEqual(8221);
      expect(Number(flag("--port"))).toBeLessThanOrEqual(8240);
      expect(seen.llamaKey).toBe(asr.server.apiKey);
      expect(seen.args.join(" ")).not.toContain(asr.server.apiKey);
      expect(seen.envNames).not.toContain("OPENAI_API_KEY");
      expect(seen.envNames).not.toContain("LLAMA_ARG_TOOLS");

      expect(asr.server.port).not.toBe(cleanup.port);
      expect(asr.server.apiKey).not.toBe(cleanup.apiKey);
      expect(await get(asr.server.port, "/v1/chat/completions")).toBe(401);
      await expect(asr.transcribe(wav(2, true))).resolves.toEqual({
        success: true,
        text: "一共28个人",
      });
      // Memory / Dictionary words go to the model as context (the system turn).
      await expect(asr.transcribe(wav(2, true), { context: "H1B, WhisperWoof" })).resolves.toEqual({
        success: true,
        text: "hinted",
      });
      // Over 5 minutes, decoded in pieces (the context holds ~8): one request each, texts joined.
      const before = asrRequests.count;
      await expect(asr.transcribe(wav(310, true))).resolves.toEqual({
        success: true,
        text: "一共28个人一共28个人",
      });
      expect(asrRequests.count - before).toBe(2);
      // Steady hiss never reaches the model (it would make up a sentence).
      await expect(asr.transcribe(wav(2, false))).resolves.toEqual({
        success: false,
        message: "No audio detected",
      });

      // Stopping speech leaves cleanup running, and the other way round.
      await asr.stopServer();
      await expect(cleanup.inference([{ role: "user", content: "hi" }])).resolves.toBe("polished");
      await asr.startServer("qwen3-asr-1.7b");
      await cleanup.stop();
      await expect(asr.transcribe(wav(1, true))).resolves.toMatchObject({ success: true });
    } finally {
      await asr.stopServer();
      await cleanup.stop();
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
