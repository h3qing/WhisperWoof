/**
 * The dictation widget is placed at the bottom of whichever display the cursor
 * is on. Displays arranged left of or above the primary have negative
 * coordinates (a 1440p monitor above a MacBook sits at y = -1440), and the old
 * `Math.max(0, …)` clamps pinned the widget to y = 0 — the top edge of the
 * laptop screen — instead of the bottom of the monitor the user was on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  WindowPositionUtil,
  WINDOW_SIZES,
  MAIN_WINDOW_CONFIG,
  vibrancyForSize,
  controlPanelBackground,
} from "../../../helpers/windowConfig.js";

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

describe("native vibrancy per overlay size", () => {
  it("gives only the live panel size a native material, sized exactly to the panel", () => {
    // The material fills the whole window rectangle, so it is only safe where
    // the window IS the panel.
    expect(vibrancyForSize("LIVE_PANEL")).toBe("hud");
    // Idle live mode shows only Mando in the same rectangle: no material.
    expect(vibrancyForSize("LIVE")).toBeNull();
    expect(vibrancyForSize("BASE")).toBeNull();
    expect(vibrancyForSize("WITH_TOAST")).toBeNull();
    expect(vibrancyForSize("WITH_MENU")).toBeNull();
    expect(WINDOW_SIZES.LIVE_PANEL).toEqual({ width: 320, height: 112 });
    expect(WINDOW_SIZES.LIVE).toEqual(WINDOW_SIZES.LIVE_PANEL);
  });

  it("ignores size keys that are not its own (renderer input)", () => {
    expect(vibrancyForSize("__proto__")).toBeNull();
    expect(vibrancyForSize("toString")).toBeNull();
  });

  it("keeps the dictation overlay's material active while unfocused", () => {
    expect(MAIN_WINDOW_CONFIG.visualEffectState).toBe("active");
  });
});

describe("control panel first paint", () => {
  // The window is painted before the renderer loads; if this drifts from the
  // theme's --color-background the window flashes a foreign colour on open.
  const css = readFileSync(resolve(__dirname, "../../../index.css"), "utf8");
  const backgroundIn = (block: string) =>
    block.match(/--color-background:\s*(#[0-9a-f]{6})/i)?.[1]?.toLowerCase();
  const lightBlock = css.slice(css.indexOf("@theme {"), css.indexOf("\n}\n", css.indexOf("@theme {")));
  const darkBlock = css.slice(css.indexOf("\n.dark {"), css.indexOf("\n}\n", css.indexOf("\n.dark {")));

  it("matches the light theme's backdrop", () => {
    expect(controlPanelBackground(false)).toBe(backgroundIn(lightBlock));
  });
  it("matches the dark theme's backdrop", () => {
    expect(controlPanelBackground(true)).toBe(backgroundIn(darkBlock));
  });
});
