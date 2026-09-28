/**
 * Only the app's own page may use IPC, and only http(s)/mailto links leave
 * the app: a local HTML file or web page that ends up in a window gets
 * nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  isAppPageUrl,
  isSafeExternalUrl,
  installIpcSenderGuard,
  UntrustedSenderError,
} = require("../../bridge/app-origin-pure.js");

const INDEX = "/Applications/WhisperWoof.app/Contents/Resources/app.asar/src/dist/index.html";
const PROD = { indexPath: INDEX };
const DEV = { devServerUrl: "http://127.0.0.1:5183/" };

describe("isAppPageUrl", () => {
  it("accepts the packaged index.html with any query or hash", () => {
    expect(isAppPageUrl(`file://${INDEX}`, PROD, "darwin")).toBe(true);
    expect(isAppPageUrl(`file://${INDEX}?panel=true#/history`, PROD, "darwin")).toBe(true);
    expect(isAppPageUrl(`file://${INDEX.replace("WhisperWoof.app", "WhisperWoof%2Eapp")}`, PROD, "darwin")).toBe(true);
  });

  it("refuses any other local file, network path or scheme", () => {
    expect(isAppPageUrl("file:///Users/me/Downloads/evil.html", PROD, "darwin")).toBe(false);
    expect(isAppPageUrl(`file://${INDEX}/../../evil.html`, PROD, "darwin")).toBe(false);
    expect(isAppPageUrl(`file://attacker.example${INDEX}`, PROD, "darwin")).toBe(false);
    expect(isAppPageUrl("https://evil.example/", PROD, "darwin")).toBe(false);
    expect(isAppPageUrl("devtools://devtools/bundled/inspector.html", PROD, "darwin")).toBe(false);
    expect(isAppPageUrl("", PROD, "darwin")).toBe(false);
    expect(isAppPageUrl(`file://${INDEX}`, null, "darwin")).toBe(false);
  });

  it("in development accepts only the Vite server's origin", () => {
    expect(isAppPageUrl("http://127.0.0.1:5183/?panel=true", DEV)).toBe(true);
    expect(isAppPageUrl("http://127.0.0.1:5184/", DEV)).toBe(false);
    expect(isAppPageUrl("http://localhost:5183/", DEV)).toBe(false);
    expect(isAppPageUrl(`file://${INDEX}`, DEV)).toBe(false);
  });
});

describe("isSafeExternalUrl", () => {
  it("lets only http(s) and mailto out", () => {
    expect(isSafeExternalUrl("https://github.com/h3qing/whisperwoof")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("mailto:hi@example.com")).toBe(true);
    for (const url of [
      "file:///Applications/Calculator.app",
      "smb://attacker/share",
      "javascript:alert(1)",
      "x-apple.systempreferences:com.apple.preference",
      "vscode://file/etc/passwd",
      "not a url",
      undefined,
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  });
});

function fakeIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
  emitter.handle = (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn);
  emitter.handleOnce = emitter.handle;
  emitter.invoke = (channel: string, event: unknown, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!(event, ...args));
  return emitter;
}

const eventFrom = (url: string | null) => ({ senderFrame: url === null ? null : { url } });

describe("installIpcSenderGuard", () => {
  const trusted = (url: string) => isAppPageUrl(url, PROD, "darwin");

  it("runs handlers for the app's page and refuses everyone else", async () => {
    const ipc = fakeIpcMain();
    const refused = vi.fn();
    installIpcSenderGuard(ipc, trusted, refused);
    ipc.handle("get-openai-key", () => "sk-secret");

    await expect(ipc.invoke("get-openai-key", eventFrom(`file://${INDEX}?panel=true`))).resolves.toBe("sk-secret");
    await expect(ipc.invoke("get-openai-key", eventFrom("file:///tmp/evil.html"))).rejects.toBeInstanceOf(
      UntrustedSenderError
    );
    await expect(ipc.invoke("get-openai-key", eventFrom(null))).rejects.toBeInstanceOf(UntrustedSenderError);
    expect(refused).toHaveBeenCalledWith("get-openai-key", "file:///tmp/evil.html");
  });

  it("drops send() from strangers and answers their sendSync with null", () => {
    const ipc = fakeIpcMain();
    installIpcSenderGuard(ipc, trusted);
    const listener = vi.fn();
    ipc.on("paste-text", listener);

    ipc.emit("paste-text", eventFrom(`file://${INDEX}`), "hello");
    const stranger: Record<string, unknown> = eventFrom("https://evil.example/");
    ipc.emit("paste-text", stranger, "rm -rf ~");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe("hello");
    expect(stranger.returnValue).toBe(null);
  });

  it("still removes a listener by the function it was added with", () => {
    const ipc = fakeIpcMain();
    installIpcSenderGuard(ipc, trusted);
    const listener = vi.fn();
    ipc.on("ch", listener);
    ipc.removeListener("ch", listener);
    ipc.emit("ch", eventFrom(`file://${INDEX}`));
    expect(listener).not.toHaveBeenCalled();
  });

  it("installs once", () => {
    const ipc = fakeIpcMain();
    installIpcSenderGuard(ipc, trusted);
    const handle = ipc.handle;
    installIpcSenderGuard(ipc, trusted);
    expect(ipc.handle).toBe(handle);
  });
});
