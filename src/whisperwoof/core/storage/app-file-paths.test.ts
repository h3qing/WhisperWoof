/**
 * Path containment for files the app owns, against a real temp folder with
 * real symlinks: only files that truly live inside an app folder may be read
 * or deleted, whatever path the renderer or a DB row hands over.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { resolveInsideDirs, appFileDirs } = require("../../bridge/app-file-paths-pure.js");

let root = "";
let imagesDir = "";
let outside = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ww-paths-"));
  imagesDir = path.join(root, "whisperwoof-images");
  fs.mkdirSync(imagesDir);
  fs.writeFileSync(path.join(imagesDir, "a.png"), "img");
  outside = path.join(root, "secret.txt");
  fs.writeFileSync(outside, "secret");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const resolve = (p: unknown) => resolveInsideDirs(p, [imagesDir], fs.realpathSync);

describe("resolveInsideDirs", () => {
  it("accepts a file inside the folder and returns its real path", () => {
    const file = path.join(imagesDir, "a.png");
    expect(resolve(file)).toBe(fs.realpathSync(file));
  });

  it("rejects `..` traversal out of the folder", () => {
    expect(resolve(path.join(imagesDir, "..", "secret.txt"))).toBeNull();
    expect(resolve(`${imagesDir}/../secret.txt`)).toBeNull();
  });

  it("rejects an absolute path outside the folder", () => {
    expect(resolve(outside)).toBeNull();
    expect(resolve("/etc/hosts")).toBeNull();
  });

  it("rejects a symlink inside the folder that escapes it", () => {
    const link = path.join(imagesDir, "escape.png");
    fs.symlinkSync(outside, link);
    expect(resolve(link)).toBeNull();
  });

  it("rejects a symlinked subfolder that escapes it", () => {
    const linkDir = path.join(imagesDir, "sub");
    fs.symlinkSync(root, linkDir);
    expect(resolve(path.join(linkDir, "secret.txt"))).toBeNull();
  });

  it("accepts a symlink that stays inside the folder", () => {
    const link = path.join(imagesDir, "alias.png");
    fs.symlinkSync(path.join(imagesDir, "a.png"), link);
    expect(resolve(link)).toBe(fs.realpathSync(path.join(imagesDir, "a.png")));
  });

  it("rejects a sibling folder that only shares the name prefix", () => {
    const evilDir = `${imagesDir}-evil`;
    fs.mkdirSync(evilDir);
    fs.writeFileSync(path.join(evilDir, "x.png"), "x");
    expect(resolve(path.join(evilDir, "x.png"))).toBeNull();
  });

  it("rejects the folder itself, relative paths, missing files and non-strings", () => {
    expect(resolve(imagesDir)).toBeNull();
    expect(resolve("whisperwoof-images/a.png")).toBeNull();
    expect(resolve(path.join(imagesDir, "missing.png"))).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve(42)).toBeNull();
    expect(resolve("")).toBeNull();
  });

  it("rejects everything when the folder doesn't exist", () => {
    const gone = path.join(root, "gone");
    expect(resolveInsideDirs(outside, [gone], fs.realpathSync)).toBeNull();
  });

  it("checks each folder on its own", () => {
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    const clip = path.join(audioDir, "1.webm");
    fs.writeFileSync(clip, "a");
    expect(resolveInsideDirs(clip, [imagesDir, audioDir], fs.realpathSync)).toBe(fs.realpathSync(clip));
    expect(resolveInsideDirs(outside, [imagesDir, audioDir], fs.realpathSync)).toBeNull();
  });
});

describe("appFileDirs", () => {
  it("is the images and audio folders under userData", () => {
    expect(appFileDirs("/u")).toEqual([path.join("/u", "whisperwoof-images"), path.join("/u", "audio")]);
  });
});
