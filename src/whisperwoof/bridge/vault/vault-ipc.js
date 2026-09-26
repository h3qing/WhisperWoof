/**
 * IPC for the Encryption settings and the lock screen. Narrow on purpose:
 * no handler returns key material; passwords and phrases only flow in.
 * Status changes are pushed to every window as "vault-status".
 */

const { BrowserWindow } = require("electron");
const controller = require("./vault-controller");

const str = (v) => (typeof v === "string" ? v : "");
const obj = (v) => (v && typeof v === "object" ? v : {});

function reauthArg(raw) {
  const r = obj(raw);
  if (typeof r.password === "string") return { password: r.password };
  if (r.touchId === true) return { touchId: true };
  return null;
}

function confirmWordsArg(raw) {
  const words = obj(raw);
  return Object.fromEntries(
    Object.entries(words)
      .filter(([k, v]) => /^\d{1,2}$/.test(k) && typeof v === "string")
      .map(([k, v]) => [Number(k), v.slice(0, 32)])
  );
}

function broadcast(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("vault-status", status);
  }
}

function registerVaultIpc(ipcMain) {
  controller.onStatus(broadcast);
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));

  handle("vault-get-status", () => controller.getStatus());
  handle("vault-begin-setup", () => controller.beginSetup());
  handle("vault-copy-phrase", () => controller.copyPhrase());
  handle("vault-complete-setup", (a) => {
    const args = obj(a);
    return controller.completeSetup({
      password: str(args.password),
      confirmWords: confirmWordsArg(args.confirmWords),
      useTouchId: args.useTouchId === true,
      notesReadable: args.notesReadable === true,
    });
  });
  handle("vault-unlock-touchid", () => controller.unlockWithTouchId());
  handle("vault-unlock-password", (password) => controller.unlockWithPassword(str(password)));
  handle("vault-recover", (a) => controller.recover({ phrase: str(obj(a).phrase), newPassword: str(obj(a).newPassword) }));
  handle("vault-lock", () => controller.lockNow());
  handle("vault-change-password", (a) =>
    controller.changePassword({ currentPassword: str(obj(a).currentPassword), newPassword: str(obj(a).newPassword) })
  );
  handle("vault-set-touchid", (enabled) => controller.setTouchIdEnabled(enabled === true));
  handle("vault-retry", () => controller.retry());
  handle("vault-set-prefs", (prefs, reauth) => {
    const p = obj(prefs);
    const allowed = {};
    if (typeof p.lockOnSleep === "boolean") allowed.lockOnSleep = p.lockOnSleep;
    if (typeof p.idleMinutes === "number") allowed.idleMinutes = p.idleMinutes;
    if (typeof p.notesReadable === "boolean") allowed.notesReadable = p.notesReadable;
    return controller.setPrefs(allowed, reauthArg(reauth));
  });
  handle("vault-begin-new-phrase", (reauth) => controller.beginNewPhrase(reauthArg(reauth)));
  handle("vault-complete-new-phrase", (a) => controller.completeNewPhrase({ confirmWords: confirmWordsArg(obj(a).confirmWords) }));
  handle("vault-disable", (reauth) => controller.disable(reauthArg(reauth)));
}

module.exports = { registerVaultIpc };
