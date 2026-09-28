/**
 * App origin — which pages count as the app itself (no electron).
 *
 * Every window loads the same preload, and the preload hands its page ~400
 * IPC channels: API keys, clipboard history, the vault, paste, plugins. So
 * "the sender is one of our windows" is not enough; the sender must be OUR
 * page. Anything else that ends up in a window (a local HTML file, a web
 * page reached by a link) is treated as a stranger:
 *
 *   - navigation and new windows are refused, links go to the browser only
 *     when they are http(s) or mailto,
 *   - IPC from any other page is refused before a handler runs.
 */

const path = require("path");
const { fileURLToPath } = require("url");

/** Link schemes the app will hand to the OS. `file:`, `smb:` and custom
 *  schemes can launch apps or mount shares, so they never leave the app. */
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function parseUrl(url) {
  if (typeof url !== "string" || url === "") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isSafeExternalUrl(url) {
  const parsed = parseUrl(url);
  return !!parsed && EXTERNAL_PROTOCOLS.has(parsed.protocol);
}

function samePath(a, b, platform) {
  const na = path.normalize(a);
  const nb = path.normalize(b);
  return platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * True when `url` is the app's own page.
 *
 * `appPage` is `{ indexPath }` for a packaged build (the one index.html the
 * windows load; any query or hash is fine) or `{ devServerUrl }` in
 * development (same origin as the Vite server).
 */
function isAppPageUrl(url, appPage, platform = process.platform) {
  const parsed = parseUrl(url);
  if (!parsed || !appPage) return false;

  if (appPage.devServerUrl) {
    const dev = parseUrl(appPage.devServerUrl);
    return !!dev && parsed.protocol === dev.protocol && parsed.origin === dev.origin;
  }

  if (appPage.indexPath && parsed.protocol === "file:") {
    // file://server/share/... is a network path, never the app bundle.
    if (parsed.host && parsed.host !== "localhost") return false;
    let filePath;
    try {
      filePath = fileURLToPath(parsed);
    } catch {
      return false;
    }
    return samePath(filePath, appPage.indexPath, platform);
  }

  return false;
}

function senderUrlOf(event) {
  try {
    const url = event?.senderFrame?.url;
    return typeof url === "string" ? url : null;
  } catch {
    // The frame was destroyed or navigated away while the message was queued.
    return null;
  }
}

class UntrustedSenderError extends Error {
  constructor(channel) {
    super(`IPC "${channel}" refused: the sender is not the app's own page`);
    this.name = "UntrustedSenderError";
  }
}

/**
 * Wrap `ipcMain.handle/handleOnce/on/once` so every handler registered from
 * now on first checks `event.senderFrame.url` with `isTrustedUrl`. Install it
 * before any handler is registered. Refused `invoke`s reject; refused
 * `send`s are dropped (a `sendSync` gets `null`). `onRefused(channel, url)`
 * is called for logging.
 */
function installIpcSenderGuard(ipcMain, isTrustedUrl, onRefused = () => {}) {
  if (!ipcMain || ipcMain.__wwSenderGuard) return;

  const trusted = (event) => {
    const url = senderUrlOf(event);
    return url !== null && isTrustedUrl(url);
  };

  const wrappedListeners = new WeakMap();

  for (const method of ["handle", "handleOnce"]) {
    const original = ipcMain[method].bind(ipcMain);
    ipcMain[method] = (channel, handler) =>
      original(channel, (event, ...args) => {
        if (!trusted(event)) {
          onRefused(channel, senderUrlOf(event));
          throw new UntrustedSenderError(channel);
        }
        return handler(event, ...args);
      });
  }

  for (const method of ["on", "once", "addListener", "prependListener"]) {
    if (typeof ipcMain[method] !== "function") continue;
    const original = ipcMain[method].bind(ipcMain);
    ipcMain[method] = (channel, listener) => {
      const wrapped = (event, ...args) => {
        if (!trusted(event)) {
          onRefused(channel, senderUrlOf(event));
          try {
            event.returnValue = null;
          } catch {
            /* not a sendSync */
          }
          return;
        }
        return listener(event, ...args);
      };
      wrappedListeners.set(listener, wrapped);
      return original(channel, wrapped);
    };
  }

  for (const method of ["removeListener", "off"]) {
    if (typeof ipcMain[method] !== "function") continue;
    const original = ipcMain[method].bind(ipcMain);
    ipcMain[method] = (channel, listener) =>
      original(channel, wrappedListeners.get(listener) || listener);
  }

  Object.defineProperty(ipcMain, "__wwSenderGuard", { value: true });
}

module.exports = {
  EXTERNAL_PROTOCOLS,
  isSafeExternalUrl,
  isAppPageUrl,
  installIpcSenderGuard,
  UntrustedSenderError,
};
