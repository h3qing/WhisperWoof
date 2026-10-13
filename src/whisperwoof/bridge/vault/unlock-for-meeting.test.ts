import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createUnlockForMeeting } = require("./unlock-for-meeting.js");

function setup({ on = true, unlocked = false, touchIdWorks = false } = {}) {
  const state = { unlocked };
  const vault = { isOn: () => on, isUnlocked: () => state.unlocked };
  const controller = {
    unlockWithTouchId: vi.fn(async () => {
      if (touchIdWorks) state.unlocked = true;
      return touchIdWorks ? { ok: true } : { ok: false, error: "Touch ID isn't set up" };
    }),
  };
  const showLockScreen = vi.fn(async () => {});
  const unlock = createUnlockForMeeting({ vault, controller, showLockScreen });
  return { unlock, controller, showLockScreen };
}

describe("createUnlockForMeeting", () => {
  it("encryption off: nothing to unlock", async () => {
    const { unlock, controller, showLockScreen } = setup({ on: false });
    expect(await unlock()).toBe(true);
    expect(controller.unlockWithTouchId).not.toHaveBeenCalled();
    expect(showLockScreen).not.toHaveBeenCalled();
  });

  it("already unlocked: nothing to ask", async () => {
    const { unlock, controller } = setup({ unlocked: true });
    expect(await unlock()).toBe(true);
    expect(controller.unlockWithTouchId).not.toHaveBeenCalled();
  });

  it("locked: Touch ID right away", async () => {
    const { unlock, showLockScreen } = setup({ touchIdWorks: true });
    expect(await unlock()).toBe(true);
    expect(showLockScreen).not.toHaveBeenCalled();
  });

  it("Touch ID declined or not set up: shows the lock screen", async () => {
    const { unlock, showLockScreen } = setup();
    expect(await unlock()).toBe(false);
    expect(showLockScreen).toHaveBeenCalledTimes(1);
  });

  it("Touch ID throwing still falls back to the lock screen", async () => {
    const { unlock, controller, showLockScreen } = setup();
    controller.unlockWithTouchId.mockRejectedValueOnce(new Error("helper died"));
    expect(await unlock()).toBe(false);
    expect(showLockScreen).toHaveBeenCalledTimes(1);
  });
});
