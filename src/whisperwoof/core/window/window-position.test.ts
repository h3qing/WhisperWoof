/**
 * The dictation widget is placed at the bottom of whichever display the cursor
 * is on. Displays arranged left of or above the primary have negative
 * coordinates (a 1440p monitor above a MacBook sits at y = -1440), and the old
 * `Math.max(0, …)` clamps pinned the widget to y = 0 — the top edge of the
 * laptop screen — instead of the bottom of the monitor the user was on.
 */
import { describe, it, expect } from "vitest";
import { WindowPositionUtil } from "../../../helpers/windowConfig.js";

const laptop = { workArea: { x: 0, y: 33, width: 1512, height: 949 } };
// BenQ 2560x1440 arranged above the laptop, shifted 445pt left (Electron coords).
const monitorAbove = { workArea: { x: -445, y: -1440, width: 2560, height: 1440 } };
const monitorLeft = { workArea: { x: -2560, y: 0, width: 2560, height: 1415 } };
const size = { width: 220, height: 188 };

describe("WindowPositionUtil.getMainWindowPosition", () => {
  it("centers at the bottom of the primary display", () => {
    expect(WindowPositionUtil.getMainWindowPosition(laptop, size, "center")).toEqual({
      x: 646,
      y: 33 + 949 - 188 - 48,
      ...size,
    });
  });

  it("stays on a monitor arranged above the primary (negative y)", () => {
    const pos = WindowPositionUtil.getMainWindowPosition(monitorAbove, size, "center");
    expect(pos.x).toBe(-445 + (2560 - 220) / 2);
    expect(pos.y).toBe(-1440 + 1440 - 188 - 48);
  });

  it("stays on a monitor arranged left of the primary (negative x)", () => {
    const right = WindowPositionUtil.getMainWindowPosition(monitorLeft, size, "bottom-right");
    expect(right.x).toBe(-2560 + 2560 - 220 - 48);
    const left = WindowPositionUtil.getMainWindowPosition(monitorLeft, size, "bottom-left");
    expect(left.x).toBe(-2560 + 48);
  });

  it("never places the window above the top of the display's work area", () => {
    const tiny = { workArea: { x: 0, y: -300, width: 800, height: 200 } };
    expect(WindowPositionUtil.getMainWindowPosition(tiny, size, "center").y).toBe(-300);
  });
});
