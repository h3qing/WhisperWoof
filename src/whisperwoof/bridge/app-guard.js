/**
 * App guard — keeps every window on the app's own page (main process).
 *
 * Rules live in app-origin-pure.js. This file wires them into Electron:
 *   - IPC: handlers registered after `installIpcGuard()` refuse any sender
 *     that isn't the app's page. Call it before any `ipcMain.handle`.
 *   - Windows: every webContents refuses navigation away from the app page,
 *     new windows and <webview>; http(s)/mailto links open in the browser.
 *   - Permissions (mic, notifications, clipboard…): only the app page gets
 *     them.
 */

const { app, ipcMain, session, shell } = require("electron");
const DevServerManager = require("../../helpers/devServerManager");
const { isAppPageUrl, isSafeExternalUrl, installIpcSenderGuard } = require("./app-origin-pure");

function isDevelopment() {
  return process.env.NODE_ENV === "development" && !app.isPackaged;
}

function appPage() {
  if (isDevelopment()) return { devServerUrl: DevServerManager.DEV_SERVER_URL };
  const fileInfo = DevServerManager.getAppFilePath(true);
  return fileInfo ? { indexPath: fileInfo.path } : null;
}

function isAppUrl(url) {
  return isAppPageUrl(url, appPage());
}

function warn(message, meta) {
  try {
    require("../../helpers/debugLogger").warn(message, meta);
  } catch {
    /* logger not ready yet */
  }
}

/** Open a link in the default browser/mail app, but only http(s) and mailto. */
function openExternalSafely(url) {
  if (!isSafeExternalUrl(url)) {
    warn("Refused to open a link with an unsafe scheme", { scheme: String(url).split(":")[0] });
    return false;
  }
  shell.openExternal(url).catch(() => {});
  return true;
}

function installIpcGuard() {
  installIpcSenderGuard(ipcMain, isAppUrl, (channel, senderUrl) => {
    warn("Refused IPC from a page that isn't the app", {
      channel,
      sender: senderUrl ? senderUrl.slice(0, 200) : null,
    });
  });
}

function guardWebContents(contents) {
  if (contents.getType() === "devtools") return;

  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  // Sub-frames (the app has none) and redirects must not leave the app page either.
  contents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame || isAppUrl(details.url)) return;
    details.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  contents.on("will-attach-webview", (event) => event.preventDefault());

  // A page can't veto a reload: locking and unlocking reload the windows to
  // drop decrypted text, and a planted beforeunload must not cancel that.
  contents.on("will-prevent-unload", (event) => event.preventDefault());

  // Windows that set their own handler (the control panel) replace this one.
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
}

function permissionUrl(webContents, details) {
  if (details && typeof details.requestingUrl === "string" && details.requestingUrl) {
    return details.requestingUrl;
  }
  try {
    return webContents && !webContents.isDestroyed() ? webContents.getURL() : "";
  } catch {
    return "";
  }
}

function installPermissionGuard() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = isAppUrl(permissionUrl(webContents, details));
    if (!allowed) warn("Refused a permission request from a page that isn't the app", { permission });
    callback(allowed);
  });
  ses.setPermissionCheckHandler((webContents, _permission, _origin, details) =>
    isAppUrl(permissionUrl(webContents, details))
  );
}

/** Call once, before any window is created (web-contents-created must be on). */
function installWindowGuards() {
  app.on("web-contents-created", (_event, contents) => guardWebContents(contents));
}

module.exports = {
  installIpcGuard,
  installWindowGuards,
  installPermissionGuard,
  openExternalSafely,
  isAppUrl,
};
