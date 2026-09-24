/**
 * TextEditMonitor.captureTargetPid runs a JXA one-liner at hotkey press
 * that prints "<pid>|<bundle id>" for the app being dictated into.
 */
import { describe, it, expect } from "vitest";
import { FRONTMOST_APP_JXA, parseFrontmostApp } from "./frontmost-app";

describe("parseFrontmostApp", () => {
  it("parses pid and bundle id", () => {
    expect(parseFrontmostApp("123|com.apple.Notes\n")).toEqual({ pid: 123, bundleId: "com.apple.Notes" });
  });

  it("returns null for a missing bundle id or pid", () => {
    expect(parseFrontmostApp("123|")).toEqual({ pid: 123, bundleId: null });
    expect(parseFrontmostApp("x|com.a")).toEqual({ pid: null, bundleId: "com.a" });
    expect(parseFrontmostApp("")).toEqual({ pid: null, bundleId: null });
  });

  it("prints an empty bundle id rather than 'undefined' for apps without one", () => {
    expect(FRONTMOST_APP_JXA).toContain('|| ""');
  });
});
