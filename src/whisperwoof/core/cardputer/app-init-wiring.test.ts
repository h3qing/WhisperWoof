/**
 * app-init.js starts the Cardputer inbox next to the Telegram sync (it stays
 * off unless the setting is on: the inbox checks) with its Settings IPC, and
 * stops it on shutdown. Everything app-init touches is a stand-in here.
 */
import { createRequire } from "module";
import { describe, it, expect, vi } from "vitest";

const require = createRequire(import.meta.url);

function inject(request: string, exports: unknown) {
  const resolved = require.resolve(request);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  } as unknown as NodeJS.Module;
}

function loadAppInit() {
  const ipcMain = { handle: vi.fn() };
  const inbox = { registerIpc: vi.fn(), start: vi.fn(), stop: vi.fn(async () => {}) };
  const telegram = { startTelegramSync: vi.fn(), stopTelegramSync: vi.fn() };
  inject("electron", {
    app: { getPath: () => "/tmp/ww-userdata" },
    clipboard: {},
    nativeImage: {},
    ipcMain,
  });
  inject("better-sqlite3-multiple-ciphers", function Database() {});
  inject("../../../helpers/debugLogger.js", {
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  inject("../../bridge/vault/vault-service.js", { isOn: () => false });
  inject("../../bridge/vault/vault-files.js", {});
  inject("../../bridge/vault/vault-db.js", {
    openDatabase: () => {
      throw Object.assign(new Error("locked"), { code: "LOCKED" });
    },
  });
  inject("../../bridge/markdown-route.js", {
    readSettings: () => ({ clipboardCapture: { monitor: false } }),
  });
  inject("../../bridge/style-learner.js", { purgeStyleExamples: vi.fn() });
  inject("../../bridge/clipboard-image-text.js", { start: vi.fn(), stop: vi.fn() });
  inject("../../bridge/telegram-sync.js", telegram);
  inject("../../bridge/cardputer-inbox.js", inbox);
  delete require.cache[require.resolve("../../bridge/app-init.js")];
  return { appInit: require("../../bridge/app-init.js"), ipcMain, inbox, telegram };
}

describe("app-init and the Cardputer inbox", () => {
  it("registers the inbox's IPC and starts it with the other background syncs, then stops it", async () => {
    const { appInit, ipcMain, inbox, telegram } = loadAppInit();
    await appInit.initializeWhisperWoof();
    expect(telegram.startTelegramSync).toHaveBeenCalled();
    expect(inbox.registerIpc).toHaveBeenCalledWith(ipcMain);
    expect(inbox.start).toHaveBeenCalledTimes(1);

    await appInit.shutdownWhisperWoof();
    expect(inbox.stop).toHaveBeenCalledTimes(1);
  });
});
