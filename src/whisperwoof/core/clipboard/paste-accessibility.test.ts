import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => {
  const noop = vi.fn();
  return {
    default: { log: noop, debug: noop, info: noop, warn: noop, error: noop },
    log: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
});

const ClipboardManager: any = await import("../../../helpers/clipboard").then(
  (m: any) => m.default ?? m
);

describe("ClipboardManager accessibility prompt on the paste path", () => {
  const origPlatform = process.platform;
  let isTrusted: ReturnType<typeof vi.fn>;

  // `isTrustedAccessibilityClient(prompt)`:
  //   prompt=false → silent check (returns current trust state, no UI)
  //   prompt=true  → shows the macOS prompt AND registers the app in
  //                  System Settings → Privacy & Security → Accessibility
  // We override the _systemPreferences() seam because Vitest can't mock a CJS
  // require("electron") inside source files (only ESM imports).
  const makeManager = (granted: boolean) => {
    isTrusted = vi.fn(() => granted);
    const cm = new ClipboardManager();
    cm._systemPreferences = () => ({ isTrustedAccessibilityClient: isTrusted });
    return cm;
  };

  const promptCalls = () => isTrusted.mock.calls.filter((c: unknown[]) => c[0] === true);

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("surfaces the macOS system prompt the first time a paste finds permission missing", async () => {
    const cm = makeManager(false); // not granted

    const allowed = await cm.checkAccessibilityPermissions();

    expect(allowed).toBe(false);
    // Regression guard: the old paste path only ever did the silent check
    // (false) and never registered the app, so the user never appeared in the
    // Accessibility list. We must now trigger the prompting variant (true).
    expect(promptCalls()).toHaveLength(1);
  });

  it("prompts at most once per session even across repeated failed pastes", async () => {
    const cm = makeManager(false);

    await cm.checkAccessibilityPermissions();
    // Bust the 5s debounce cache so the second call performs a fresh check.
    cm.accessibilityCache = { value: null, expiresAt: 0 };
    await cm.checkAccessibilityPermissions();

    // Silent check runs each time, but the user is prompted only once (no nagging).
    expect(promptCalls()).toHaveLength(1);
  });

  it("never prompts when Accessibility is already granted", async () => {
    const cm = makeManager(true); // granted

    const allowed = await cm.checkAccessibilityPermissions();

    expect(allowed).toBe(true);
    expect(promptCalls()).toHaveLength(0);
  });

  it("does not prompt off macOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const cm = makeManager(false);

    const allowed = await cm.checkAccessibilityPermissions();

    expect(allowed).toBe(true); // non-darwin short-circuits to allowed
    expect(promptCalls()).toHaveLength(0);
  });
});

describe("ClipboardManager puts the earlier clipboard back only when it isn't private", () => {
  const withHistory = (isPrivate: boolean | (() => boolean)) => {
    const cm = new ClipboardManager();
    cm._clipboardHistory = () => ({
      isPrivateCopy: typeof isPrivate === "function" ? isPrivate : () => isPrivate,
    });
    return cm;
  };

  it("restores an ordinary copy", () => {
    expect(withHistory(false)._shouldRestoreClipboard({})).toBe(true);
  });

  // Regression: the old paste read the password as plain text and wrote it
  // back ~0.6 s later without its concealed marker, so the clipboard history
  // saw a new, unmarked copy and kept the password.
  it("never restores a password manager's copy", () => {
    expect(withHistory(true)._shouldRestoreClipboard({})).toBe(false);
  });

  it("doesn't restore when it can't tell", () => {
    const cm = withHistory(() => {
      throw new Error("pasteboard busy");
    });
    expect(cm._shouldRestoreClipboard({})).toBe(false);
  });

  it("respects restoreClipboard: false", () => {
    expect(withHistory(false)._shouldRestoreClipboard({ restoreClipboard: false })).toBe(false);
  });
});
