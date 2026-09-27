/**
 * Downloads of executables/models: https on every hop, the GitHub token only
 * for api.github.com, and GitHub's published SHA-256 checked before anything
 * is extracted, chmodded or run.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  isHttpsUrl,
  requireHttpsUrl,
  resolveHttpsRedirect,
  githubTokenAllowed,
  normalizeSha256,
  parseGithubDigest,
  checksumMismatchError,
} = require("../../bridge/download-integrity-pure.js");
const { downloadFile, sha256File } = require("../../../helpers/downloadUtils.js");

const HEX = "a".repeat(64);

describe("https-only URLs", () => {
  it("accepts https and rejects everything else", () => {
    expect(isHttpsUrl("https://github.com/x")).toBe(true);
    for (const bad of ["http://github.com/x", "ftp://x/y", "file:///etc/passwd", "github.com/x", "", null]) {
      expect(isHttpsUrl(bad)).toBe(false);
      expect(() => requireHttpsUrl(bad)).toThrow();
    }
    try {
      requireHttpsUrl("http://huggingface.co/m.gguf");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("ERR_INSECURE_URL");
    }
  });
});

describe("resolveHttpsRedirect", () => {
  const from = "https://api.github.com/repos/o/r/releases/assets/1";

  it("follows absolute https redirects", () => {
    expect(
      resolveHttpsRedirect(from, "https://release-assets.githubusercontent.com/a?sig=1")
    ).toBe("https://release-assets.githubusercontent.com/a?sig=1");
  });

  it("resolves relative and scheme-relative locations against the current URL", () => {
    expect(resolveHttpsRedirect(from, "/repos/o/r2/releases/latest")).toBe(
      "https://api.github.com/repos/o/r2/releases/latest"
    );
    expect(resolveHttpsRedirect(from, "//objects.githubusercontent.com/x")).toBe(
      "https://objects.githubusercontent.com/x"
    );
  });

  it("refuses a downgrade to http or any other scheme", () => {
    for (const loc of ["http://objects.githubusercontent.com/x", "file:///etc/passwd", "data:text/plain,hi"]) {
      expect(() => resolveHttpsRedirect(from, loc)).toThrow(/non-HTTPS/);
      try {
        resolveHttpsRedirect(from, loc);
      } catch (err) {
        expect((err as { code?: string }).code).toBe("ERR_INSECURE_REDIRECT");
      }
    }
  });

  it("refuses a relative redirect when the current URL is http", () => {
    expect(() => resolveHttpsRedirect("http://mirror.local/a", "/b")).toThrow(/non-HTTPS/);
  });

  it("fails on a missing Location header", () => {
    expect(() => resolveHttpsRedirect(from, undefined)).toThrow(/Location/);
    expect(() => resolveHttpsRedirect(from, "")).toThrow(/Location/);
  });
});

describe("githubTokenAllowed", () => {
  it("only for https://api.github.com", () => {
    expect(githubTokenAllowed("https://api.github.com/repos/o/r/releases/latest")).toBe(true);
    for (const url of [
      "http://api.github.com/repos",
      "https://objects.githubusercontent.com/x",
      "https://release-assets.githubusercontent.com/x",
      "https://github.com/o/r/releases/download/v1/a.zip",
      "https://api.github.com.evil.com/x",
      "https://evil.com/api.github.com",
      "not a url",
    ]) {
      expect(githubTokenAllowed(url)).toBe(false);
    }
  });
});

describe("SHA-256 digests", () => {
  it("normalizes hex and treats a missing value as none", () => {
    expect(normalizeSha256(HEX.toUpperCase())).toBe(HEX);
    expect(normalizeSha256(` ${HEX} `)).toBe(HEX);
    expect(normalizeSha256(undefined)).toBeNull();
    expect(normalizeSha256(null)).toBeNull();
    expect(normalizeSha256("")).toBeNull();
  });

  it("throws on malformed hashes instead of skipping the check", () => {
    for (const bad of ["abc", "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      expect(() => normalizeSha256(bad)).toThrow(/SHA-256/);
    }
  });

  it("reads GitHub's asset digest field", () => {
    expect(parseGithubDigest(`sha256:${HEX}`)).toBe(HEX);
    expect(parseGithubDigest(`SHA256:${HEX.toUpperCase()}`)).toBe(HEX);
    // Assets from before GitHub recorded digests, or another algorithm.
    expect(parseGithubDigest(null)).toBeNull();
    expect(parseGithubDigest(undefined)).toBeNull();
    expect(parseGithubDigest("")).toBeNull();
    expect(parseGithubDigest(`sha512:${"b".repeat(128)}`)).toBeNull();
    expect(() => parseGithubDigest("sha256:nothex")).toThrow();
  });

  it("builds a non-retryable mismatch error", () => {
    const err = checksumMismatchError(HEX, "b".repeat(64));
    expect(err.code).toBe("ERR_CHECKSUM_MISMATCH");
    expect(err.isChecksumError).toBe(true);
    expect(err.message).toContain(HEX);
  });
});

describe("downloadUtils integrity guards", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-dl-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sha256File hashes the whole file", async () => {
    const file = path.join(dir, "blob.bin");
    const bytes = crypto.randomBytes(300_000);
    fs.writeFileSync(file, bytes);
    expect(await sha256File(file)).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
  });

  it("downloadFile refuses a non-https URL before touching the network or disk", async () => {
    const dest = path.join(dir, "model.bin");
    await expect(downloadFile("http://huggingface.co/x/model.bin", dest)).rejects.toMatchObject({
      code: "ERR_INSECURE_URL",
    });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("downloadFile refuses a malformed sha256 option", async () => {
    const dest = path.join(dir, "model.bin");
    await expect(
      downloadFile("https://huggingface.co/x/model.bin", dest, { sha256: "not-a-hash" })
    ).rejects.toMatchObject({ code: "ERR_BAD_DIGEST" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
