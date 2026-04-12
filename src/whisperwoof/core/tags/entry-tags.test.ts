/**
 * Tests for Entry Tagging pure logic.
 *
 * Imports `validateTagName`, `MAX_TAG_NAME_LENGTH`, and
 * `DEFAULT_TAG_COLOR` directly from `bridge/entry-tags-pure.js`. These
 * are the same rules `createTag` / `updateTag` in the production bridge
 * module delegate to — any drift here trips the test suite.
 *
 * Everything else in `bridge/entry-tags.js` is SQL against better-sqlite3
 * (uniqueness, many-to-many junction queries, stats aggregation, bulk
 * transactions). None of that loads in the vitest Node runtime, so
 * those paths are covered by manual integration instead. The previous
 * test file re-implemented them as in-memory JavaScript and asserted
 * against the re-implementation, which proved nothing about production.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — CommonJS module, no TS declarations
import {
  MAX_TAG_NAME_LENGTH,
  DEFAULT_TAG_COLOR,
  validateTagName,
} from "../../bridge/entry-tags-pure";

describe("validateTagName", () => {
  it("accepts common tag names", () => {
    expect(validateTagName("important")).toBeNull();
    expect(validateTagName("work-related")).toBeNull();
    expect(validateTagName("Meeting Notes")).toBeNull();
    expect(validateTagName("✨")).toBeNull();
  });

  it("accepts names at exactly MAX_TAG_NAME_LENGTH", () => {
    expect(validateTagName("a".repeat(MAX_TAG_NAME_LENGTH))).toBeNull();
  });

  it("trims whitespace before counting length", () => {
    const trimmed = "  " + "a".repeat(MAX_TAG_NAME_LENGTH) + "  ";
    expect(validateTagName(trimmed)).toBeNull();
  });

  it("rejects empty, whitespace-only, and nullish names", () => {
    expect(validateTagName("")).toContain("required");
    expect(validateTagName("   ")).toContain("required");
    expect(validateTagName(null)).toContain("required");
    expect(validateTagName(undefined)).toContain("required");
  });

  it("rejects names longer than MAX_TAG_NAME_LENGTH", () => {
    expect(validateTagName("a".repeat(MAX_TAG_NAME_LENGTH + 1))).toContain(String(MAX_TAG_NAME_LENGTH));
  });

  it("rejects non-string input", () => {
    expect(validateTagName(123 as unknown as string)).toBeTruthy();
    expect(validateTagName({} as unknown as string)).toBeTruthy();
    expect(validateTagName([] as unknown as string)).toBeTruthy();
  });
});

describe("DEFAULT_TAG_COLOR", () => {
  it("is the Mando coat accent (#A06A3C)", () => {
    expect(DEFAULT_TAG_COLOR).toBe("#A06A3C");
  });

  it("is a valid 6-digit hex color", () => {
    expect(DEFAULT_TAG_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("MAX_TAG_NAME_LENGTH", () => {
  it("is exported so the renderer UI can enforce the same limit", () => {
    expect(typeof MAX_TAG_NAME_LENGTH).toBe("number");
    expect(MAX_TAG_NAME_LENGTH).toBeGreaterThan(0);
  });
});
