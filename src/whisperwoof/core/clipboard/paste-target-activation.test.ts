import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => {
  const noop = vi.fn();
  return {
    default: { log: noop, debug: noop, info: noop, warn: noop, error: noop },
    log: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
});

const TextEditMonitor: any = await import("../../../helpers/textEditMonitor").then(
  (m: any) => m.default ?? m
);

// Port of upstream OpenWhispr #1000 (commit 8a88d9378): the paste keystroke is
// delivered session-wide, so the captured target app must be frontmost before
// Cmd+V fires. Chromium/Electron targets (e.g. Claude Desktop) don't reclaim
// key-window status from the overlay hide() hand-off, so paste landed nowhere.
// We override the _readFrontmostPid/_activateApp seams because Vitest can't
// mock a CJS require("child_process") inside source files (only ESM imports).
describe("TextEditMonitor.activateTargetPid", () => {
  const origPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  const makeMonitor = (targetPid: number | null, frontmostSequence: (number | null)[]) => {
    const monitor = new TextEditMonitor();
    monitor.lastTargetPid = targetPid;
    let call = 0;
    monitor._readFrontmostPid = vi.fn(async () => {
      const value = frontmostSequence[Math.min(call, frontmostSequence.length - 1)];
      call += 1;
      return value;
    });
    monitor._activateApp = vi.fn(async () => {});
    return monitor;
  };

  it("returns false off macOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const monitor = makeMonitor(7965, [7965]);

    expect(await monitor.activateTargetPid()).toBe(false);
    expect(monitor._activateApp).not.toHaveBeenCalled();
  });

  it("returns false when no target PID was captured, so the caller can fall back", async () => {
    const monitor = makeMonitor(null, [123]);

    expect(await monitor.activateTargetPid()).toBe(false);
    expect(monitor._activateApp).not.toHaveBeenCalled();
  });

  it("skips activation when the target is already frontmost", async () => {
    // Load-bearing behavior: re-activating an already-frontmost Chromium app
    // drops its text field's first responder — the exact focus loss that made
    // paste land nowhere in Claude Desktop.
    const monitor = makeMonitor(7965, [7965]);

    expect(await monitor.activateTargetPid()).toBe(true);
    expect(monitor._activateApp).not.toHaveBeenCalled();
  });

  it("activates and confirms the target became frontmost before resolving", async () => {
    // Frontmost reads: initial check (overlay pid), then poll: still overlay,
    // then the target — activation confirmed on the second poll.
    const monitor = makeMonitor(7965, [111, 111, 7965]);

    expect(await monitor.activateTargetPid()).toBe(true);
    expect(monitor._activateApp).toHaveBeenCalledTimes(1);
    expect(monitor._activateApp).toHaveBeenCalledWith(7965);
  });

  it("returns false when the target never becomes frontmost", async () => {
    const monitor = makeMonitor(7965, [111]);

    expect(await monitor.activateTargetPid()).toBe(false);
    expect(monitor._activateApp).toHaveBeenCalledTimes(1);
  });
});
