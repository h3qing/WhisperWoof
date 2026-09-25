const path = require("path");

const isGnomeWayland =
  process.platform === "linux" &&
  process.env.XDG_SESSION_TYPE === "wayland" &&
  /gnome|ubuntu|unity/i.test(process.env.XDG_CURRENT_DESKTOP || "");

const isKDEWayland =
  process.platform === "linux" &&
  process.env.XDG_SESSION_TYPE === "wayland" &&
  /kde/i.test(process.env.XDG_CURRENT_DESKTOP || "");

const MAIN_OVERLAY_TYPE =
  process.platform === "darwin"
    ? "panel"
    : process.platform === "linux"
      ? isGnomeWayland || isKDEWayland
        ? "normal"
        : "toolbar"
      : "normal";

const FLOATING_OVERLAY_TYPE =
  process.platform === "darwin"
    ? "panel"
    : process.platform === "linux"
      ? isKDEWayland
        ? "normal"
        : "toolbar"
      : "normal";

const WINDOW_SIZES = {
  BASE: { width: 220, height: 188 }, // WhisperWoof: Mando head + status + waveform (vertical, bottom-anchored). Tall enough that the head (topmost) isn't clipped in the taller "speaking" layout.
  WITH_MENU: { width: 240, height: 280 },
  WITH_TOAST: { width: 470, height: 500 }, // Wide enough for the live dictation panel's "Pasted" hold.
  EXPANDED: { width: 400, height: 500 },
  // Live mode while idle with the icon kept on screen (auto-hide off): the
  // Mando indicator at its bottom edge needs this height. Same width as the
  // panel, so a capture start only trims the top (resizes are bottom-anchored
  // and the panel sits on the bottom edge).
  LIVE: { width: 360, height: 112 },
  // The live dictation panel (a one-line ticker), and nothing else: on macOS
  // this size carries a native material that fills the whole window, so the
  // window is the panel.
  LIVE_PANEL: { width: 360, height: 72 },
};

// Native macOS material per overlay size (null = none). Only sizes whose
// window is exactly one panel qualify; toasts/menus need transparent margins.
// "hud" is the translucent heads-up material: the app behind shows through,
// blurred, where "popover" read as an opaque grey slab.
const WINDOW_VIBRANCY = { LIVE_PANEL: "hud" };

function vibrancyForSize(sizeKey) {
  return Object.hasOwn(WINDOW_VIBRANCY, sizeKey) ? WINDOW_VIBRANCY[sizeKey] : null;
}

// Main dictation window configuration
const MAIN_WINDOW_CONFIG = {
  width: WINDOW_SIZES.BASE.width,
  height: WINDOW_SIZES.BASE.height,
  title: "WhisperWoof",
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
  frame: false,
  alwaysOnTop: true,
  resizable: false,
  transparent: true,
  show: false,
  skipTaskbar: true,
  focusable: true,
  visibleOnAllWorkspaces: process.platform !== "win32",
  fullScreenable: false,
  hasShadow: false,
  acceptsFirstMouse: true,
  // The overlay never takes focus; without this its material goes flat grey.
  visualEffectState: "active",
  type: MAIN_OVERLAY_TYPE,
};

// Painted before the renderer loads; matches --color-background in index.css
// so the window doesn't flash a foreign colour on open.
function controlPanelBackground(dark) {
  return dark ? "#120e0b" : "#ebe4dc";
}

// Control panel window configuration
const CONTROL_PANEL_CONFIG = {
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    // sandbox: false is required because the preload script bridges IPC
    // between the renderer and main process.
    sandbox: false,
    // WhisperWoof: webSecurity re-enabled. Cross-origin API calls are allowed
    // via CSP connect-src in main.js. Cloud API calls should be proxied
    // through the main process for full security.
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: true, // WhisperWoof: throttle hidden windows to save memory
  },
  title: "Control Panel",
  resizable: true,
  show: false,
  frame: false,
  ...(process.platform === "darwin" && {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 24, y: 24 }, // inside the floating sidebar
  }),
  transparent: false,
  minimizable: true,
  maximizable: true,
  closable: true,
  fullscreenable: true,
  skipTaskbar: false,
  alwaysOnTop: false,
  visibleOnAllWorkspaces: false,
  type: "normal",
};

const NOTIFICATION_WINDOW_CONFIG = {
  width: 380,
  height: 88,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  focusable: false,
  hasShadow: false,
  show: false,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
  visibleOnAllWorkspaces: process.platform !== "win32",
  type: FLOATING_OVERLAY_TYPE,
};

class WindowPositionUtil {
  static getMainWindowPosition(display, customSize = null, position = "center") {
    const { width, height } = customSize || WINDOW_SIZES.BASE;
    const MARGIN = 48; // WhisperWoof: 48px from bottom edge per design spec
    const workArea = display.workArea || display.bounds;

    // Clamp to the display's own work area, never to 0: displays left of or
    // above the primary have negative coordinates, and a 0 clamp dropped the
    // widget onto the primary screen's top edge.
    const minX = workArea.x;
    const minY = workArea.y;
    const bottomY = Math.max(minY, workArea.y + workArea.height - height - MARGIN);

    let x;
    if (position === "bottom-left") {
      x = workArea.x + MARGIN;
    } else if (position === "center") {
      x = Math.round(workArea.x + (workArea.width - width) / 2); // bottom-center, just above dock
    } else {
      // bottom-right (default)
      x = Math.max(minX, workArea.x + workArea.width - width - MARGIN);
    }

    return { x, y: bottomY, width, height };
  }

  static getNotificationPosition(display) {
    const width = 380;
    const height = 88;
    const MARGIN = 16;
    const workArea = display.workArea || display.bounds;
    const x = Math.max(0, workArea.x + workArea.width - width - MARGIN);
    const y = Math.max(0, workArea.y + MARGIN);
    return { x, y, width, height };
  }

  static setupAlwaysOnTop(window) {
    if (process.platform === "darwin") {
      // macOS: Use panel level for proper floating behavior
      // This ensures the window stays on top across spaces and fullscreen apps
      window.setAlwaysOnTop(true, "floating", 1);
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true, // Keep Dock/Command-Tab behaviour
      });
      window.setFullScreenable(false);

      if (window.isVisible()) {
        window.setAlwaysOnTop(true, "floating", 1);
      }
    } else if (process.platform === "win32") {
      window.setAlwaysOnTop(true, "pop-up-menu");
    } else if (isGnomeWayland) {
      window.setAlwaysOnTop(true, "floating");
    } else {
      // KDE XWayland and other Linux — "screen-saver" is the strongest z-level
      window.setAlwaysOnTop(true, "screen-saver");
    }
  }
}

const AGENT_OVERLAY_CONFIG = {
  width: 420,
  height: 300,
  minWidth: 360,
  minHeight: 200,
  maxWidth: 800,
  maxHeight: 10000,
  frame: false,
  alwaysOnTop: true,
  transparent: true,
  show: false,
  skipTaskbar: true,
  hasShadow: false,
  focusable: true,
  resizable: false,
  fullScreenable: false,
  acceptsFirstMouse: true,
  type: FLOATING_OVERLAY_TYPE,
  visibleOnAllWorkspaces: process.platform !== "win32",
  // The chat panel fills the window, so on macOS the window is the material.
  ...(process.platform === "darwin" && { vibrancy: "popover", visualEffectState: "active" }),
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    // WhisperWoof: webSecurity re-enabled (same as control panel)
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: true, // WhisperWoof: throttle hidden windows to save memory
  },
};

module.exports = {
  MAIN_WINDOW_CONFIG,
  CONTROL_PANEL_CONFIG,
  AGENT_OVERLAY_CONFIG,
  NOTIFICATION_WINDOW_CONFIG,
  WINDOW_SIZES,
  WindowPositionUtil,
  vibrancyForSize,
  controlPanelBackground,
};
