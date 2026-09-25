import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// CI release builds run the download scripts with cleanup on. The sherpa-onnx
// script passed its keep list as an array, which cleanupFiles compared as one
// comma-joined string, so every release from 1.16.0 to 2.1.0 shipped without
// the Parakeet / live preview servers.
const require = createRequire(import.meta.url);
const { cleanupFiles } = require("../../../../scripts/lib/download-utils.js");
const { installedBinaryNames } = require("../../../../scripts/download-sherpa-onnx.js");

let binDir: string;
const touch = (name: string) => fs.writeFileSync(path.join(binDir, name), "");
const present = () => fs.readdirSync(binDir).sort();

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), "bin-cleanup-"));
});
afterEach(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe("cleanupFiles", () => {
  it("keeps every sherpa-onnx server a fresh install just put in place", () => {
    const installed = installedBinaryNames("darwin-arm64");
    installed.forEach(touch);
    touch("sherpa-onnx-darwin-arm64"); // the old CLI binary
    touch("libsherpa-onnx-c-api.dylib"); // libraries don't share the prefix

    cleanupFiles(binDir, "sherpa-onnx", installed);

    expect(present()).toEqual([...installed, "libsherpa-onnx-c-api.dylib"].sort());
  });

  it("still takes a single prefix (whisper-server, llama-server)", () => {
    touch("whisper-server-darwin-arm64");
    touch("whisper-server-darwin-x64");

    cleanupFiles(binDir, "whisper-server", "whisper-server-darwin-arm64");

    expect(present()).toEqual(["whisper-server-darwin-arm64"]);
  });
});

describe("installedBinaryNames", () => {
  it("names the offline, streaming (live preview) and diarization servers", () => {
    expect(installedBinaryNames("darwin-arm64")).toEqual([
      "sherpa-onnx-ws-darwin-arm64",
      "sherpa-onnx-online-ws-darwin-arm64",
      "sherpa-onnx-diarize-darwin-arm64",
    ]);
  });
});
