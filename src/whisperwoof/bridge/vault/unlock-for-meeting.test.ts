import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createUnlockForMeeting } = require("./unlock-for-meeting.js");

function setup({
  on = true,
  unlocked = false,
  dbOpen = true,
  touchId = "fails" as "unlocks" | "fails" | "cancelled",
  lockScreenUnlocks = false,
} = {}) {
  const state = { unlocked, dbOpen: unlocked ? dbOpen : false };
  const vault = { isOn: () => on, isUnlocked: () => state.unlocked };
  const unlockNow = () => {
    state.unlocked = true;
    state.dbOpen = true;
  };
  const controller = {
    unlockWithTouchId: vi.fn(async () => {
      if (touchId === "unlocks") {
        unlockNow();
        return { success: true };
      }
      return touchId === "cancelled"
        ? { success: false, error: "Touch ID was cancelled", code: "CANCELLED" }
        : { success: false, error: "Touch ID isn't set up", code: "UNAVAILABLE" };
    }),
  };
  const showLockScreen = vi.fn(async () => {
    if (lockScreenUnlocks) unlockNow();
  });
  const gate = createUnlockForMeeting({
    vault,
    controller,
    databaseOpen: () => state.dbOpen,
    showLockScreen,
  });
  return { gate, controller, showLockScreen };
}

describe("createUnlockForMeeting", () => {
  it("encryption off: ready, nothing asked", async () => {
    const { gate, controller, showLockScreen } = setup({ on: false });
    expect(gate.ready()).toBe(true);
    expect(await gate.unlock()).toBe("ready");
    expect(controller.unlockWithTouchId).not.toHaveBeenCalled();
    expect(showLockScreen).not.toHaveBeenCalled();
  });

  it("unlocked with the database open: ready, nothing asked", async () => {
    const { gate, controller } = setup({ unlocked: true });
    expect(await gate.unlock()).toBe("ready");
    expect(controller.unlockWithTouchId).not.toHaveBeenCalled();
  });

  it("unlocked while the unlock steps still open the database: waits, asks nothing", async () => {
    const { gate, controller, showLockScreen } = setup({ unlocked: true, dbOpen: false });
    expect(gate.ready()).toBe(false);
    expect(await gate.unlock()).toBe("waiting");
    expect(controller.unlockWithTouchId).not.toHaveBeenCalled();
    expect(showLockScreen).not.toHaveBeenCalled();
  });

  it("locked: Touch ID right away", async () => {
    const { gate, showLockScreen } = setup({ touchId: "unlocks" });
    expect(gate.ready()).toBe(false);
    expect(await gate.unlock()).toBe("ready");
    expect(showLockScreen).not.toHaveBeenCalled();
  });

  it("Touch ID cancelled: not now, no lock screen", async () => {
    const { gate, showLockScreen } = setup({ touchId: "cancelled" });
    expect(await gate.unlock()).toBe("declined");
    expect(showLockScreen).not.toHaveBeenCalled();
  });

  it("Touch ID not set up: the lock screen, then waits", async () => {
    const { gate, showLockScreen } = setup();
    expect(await gate.unlock()).toBe("waiting");
    expect(showLockScreen).toHaveBeenCalledTimes(1);
  });

  it("unlocked while the lock screen comes up: ready", async () => {
    const { gate } = setup({ lockScreenUnlocks: true });
    expect(await gate.unlock()).toBe("ready");
  });
});
