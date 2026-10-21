/**
 * Atomic writes into a session folder (bridge/cardputer-writeback.js):
 * 0600 temp file, rename, never through a symlink, and result.json never
 * over an existing one, also on volumes without hard links.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { tempRoot } from "./test-sessions";

const require = createRequire(import.meta.url);
const writeback = require("../../bridge/cardputer-writeback");

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function dir() {
  const d = tempRoot();
  roots.push(d);
  return d;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("cardputer writeback", () => {
  it("writes 0600 files atomically and returns their sha256", () => {
    const d = dir();
    const sha = writeback.writeAtomic(d, "transcript.md", "你好\n");
    expect(fs.readFileSync(path.join(d, "transcript.md"), "utf8")).toBe("你好\n");
    expect(sha).toBe(require("crypto").createHash("sha256").update("你好\n").digest("hex"));
    expect(fs.statSync(path.join(d, "transcript.md")).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(d)).toEqual(["transcript.md"]);
  });

  it("refuses names that leave the folder or start with a dot", () => {
    const d = dir();
    expect(() => writeback.writeAtomic(d, "../x.json", "{}")).toThrow();
    expect(() => writeback.writeAtomic(d, ".hidden", "{}")).toThrow();
  });

  it("never replaces an existing result.json", () => {
    const d = dir();
    fs.writeFileSync(path.join(d, "result.json"), "theirs");
    expect(() => writeback.writeAtomic(d, "result.json", "ours")).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(d, "result.json"), "utf8")).toBe("theirs");
    expect(() => writeback.assertOpen(d)).toThrow(/already exists/);
    expect(fs.readdirSync(d)).toEqual(["result.json"]); // no temp file left
  });

  it("still writes result.json on a volume without hard links (exFAT)", () => {
    const d = dir();
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw Object.assign(new Error("not supported"), { code: "ENOTSUP" });
    });
    writeback.writeAtomic(d, "result.json", "ours");
    expect(fs.readFileSync(path.join(d, "result.json"), "utf8")).toBe("ours");
    expect(fs.readdirSync(d)).toEqual(["result.json"]);
  });

  it("never recreates a session folder that is gone: every write and check says CARDPUTER_GONE", () => {
    const d = dir();
    const session = path.join(d, "1402-session");
    fs.mkdirSync(session);
    expect(() => writeback.assertOpen(session)).not.toThrow(); // there, no result.json: open
    fs.rmSync(session, { recursive: true });
    for (const name of ["status.json", "transcript.json", "result.json"]) {
      expect(
        codeOf(() => writeback.writeAtomic(session, name, "{}")),
        name
      ).toBe("CARDPUTER_GONE");
    }
    expect(codeOf(() => writeback.assertOpen(session))).toBe("CARDPUTER_GONE");
    expect(fs.readdirSync(d)).toEqual([]); // nothing recreated
  });

  it("calls a folder gone once it is moved away (to the Trash) or replaced by a file", () => {
    const d = dir();
    const session = path.join(d, "1402-session");
    fs.mkdirSync(session);
    expect(writeback.folderGone(session)).toBe(false);
    fs.renameSync(session, path.join(d, "trashed"));
    expect(writeback.folderGone(session)).toBe(true);
    fs.writeFileSync(session, "not a folder");
    expect(writeback.folderGone(session)).toBe(true);
    expect(codeOf(() => writeback.assertOpen(session))).toBe("CARDPUTER_GONE");
  });

  it("says CARDPUTER_GONE when the folder goes between the temp file and the rename", () => {
    const d = dir();
    const session = path.join(d, "1402-session");
    fs.mkdirSync(session);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      fs.rmSync(session, { recursive: true });
      return rename(from, to);
    });
    expect(codeOf(() => writeback.writeAtomic(session, "transcript.md", "x"))).toBe(
      "CARDPUTER_GONE"
    );
    expect(fs.readdirSync(d)).toEqual([]);
  });

  it("doesn't follow a symlink planted at the temp name", () => {
    const d = dir();
    const target = path.join(d, "target");
    fs.writeFileSync(target, "keep");
    vi.spyOn(require("crypto"), "randomBytes").mockReturnValue(Buffer.from("00000000", "hex"));
    fs.symlinkSync(target, path.join(d, `.status.json.${process.pid}.00000000.tmp`));
    expect(() => writeback.writeAtomic(d, "status.json", "{}")).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("keep");
  });
});
