/**
 * Per-process secrets for the loopback model servers: llama-server's API key
 * and whisper-server's capability route prefix.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  newServerApiKey,
  newServerRequestPath,
  isServerApiKey,
  isServerRequestPath,
  bearerHeaders,
  redactArgs,
} = require("../../bridge/local-server-auth-pure.js");

describe("llama-server API key", () => {
  it("is 256 random bits in hex, fresh every time", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newServerApiKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(isServerApiKey(key)).toBe(true);
    }
  });

  it("becomes a Bearer header only when it is a real key", () => {
    const key = newServerApiKey();
    expect(bearerHeaders(key)).toEqual({ Authorization: `Bearer ${key}` });
    expect(bearerHeaders(null)).toEqual({});
    expect(bearerHeaders("")).toEqual({});
    expect(bearerHeaders("short")).toEqual({});
  });
});

describe("whisper-server request path", () => {
  it("is an unguessable prefix, fresh every time", () => {
    const paths = new Set(Array.from({ length: 50 }, () => newServerRequestPath()));
    expect(paths.size).toBe(50);
    for (const p of paths) {
      expect(p).toMatch(/^\/ww-[0-9a-f]{32}$/);
      expect(isServerRequestPath(p)).toBe(true);
    }
  });

  it("contains nothing cpp-httplib would read as regex syntax", () => {
    // whisper-server registers `request_path + "/inference"` as a regex route.
    const p = newServerRequestPath();
    const route = `${p}/inference`;
    expect(new RegExp(`^${route}$`).test(route)).toBe(true);
    expect(/[.*+?^${}()|[\]\\]/.test(p)).toBe(false);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "/", "/inference", "/ww-xyz", `/ww-${"a".repeat(31)}`, null]) {
      expect(isServerRequestPath(bad)).toBe(false);
    }
  });
});

describe("redactArgs", () => {
  it("hides secrets in argv before it is logged", () => {
    const p = newServerRequestPath();
    const args = ["--port", "8178", "--request-path", p, `--x=${p}/load`];
    expect(redactArgs(args, [p])).toEqual([
      "--port",
      "8178",
      "--request-path",
      "<redacted>",
      "--x=<redacted>/load",
    ]);
    expect(args[3]).toBe(p);
  });

  it("ignores empty secrets", () => {
    expect(redactArgs(["a", "b"], ["", null])).toEqual(["a", "b"]);
    expect(redactArgs(undefined, ["x"])).toEqual([]);
  });
});
