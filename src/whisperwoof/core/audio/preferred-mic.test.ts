/**
 * Unplugging the USB mic picked in Settings made the next dictation fail with
 * OverconstrainedError (getUserMedia asked for that exact device). The pick is
 * now a preference: present → use it (by id, or by label when Chromium
 * re-keyed it), absent → the system default, and a getUserMedia that still
 * misses the device retries on the default.
 */
import { describe, it, expect, vi } from "vitest";
import {
  getUserMediaWithFallback,
  isMissingDeviceError,
  preferenceToStore,
  requestsSpecificDevice,
  resolvePreferredInputDevice,
  withoutDeviceId,
} from "./preferred-mic";

const mic = (deviceId: string, label: string, kind = "audioinput") => ({ deviceId, label, kind });

const DEVICES = [
  mic("default", "Default - MacBook Pro Microphone"),
  mic("builtin-1", "MacBook Pro Microphone"),
  mic("usb-1", "USB Audio Device (0d8c:0014)"),
  mic("speaker-1", "MacBook Pro Speakers", "audiooutput"),
];

const namedError = (name: string) => Object.assign(new Error(name), { name });
const fakeStream = (tag: string) => ({ tag }) as unknown as MediaStream;

describe("resolvePreferredInputDevice", () => {
  it("uses the preferred mic when its id is present", () => {
    expect(resolvePreferredInputDevice(DEVICES, "usb-1", "USB Audio Device (0d8c:0014)")).toEqual({
      deviceId: "usb-1",
      usedFallback: false,
      reason: "matched",
      matchedBy: "id",
      label: "USB Audio Device (0d8c:0014)",
    });
  });

  it("falls back to the system default when the preferred mic is unplugged", () => {
    const withoutUsb = DEVICES.filter((d) => d.deviceId !== "usb-1");
    expect(resolvePreferredInputDevice(withoutUsb, "usb-1", "USB Audio Device (0d8c:0014)")).toEqual({
      deviceId: undefined,
      usedFallback: true,
      reason: "not-found",
      matchedBy: null,
    });
  });

  it("finds the same mic by label when its id changed", () => {
    const rekeyed = DEVICES.map((d) => (d.deviceId === "usb-1" ? { ...d, deviceId: "usb-2" } : d));
    expect(resolvePreferredInputDevice(rekeyed, "usb-1", "USB Audio Device (0d8c:0014)")).toMatchObject({
      deviceId: "usb-2",
      usedFallback: false,
      reason: "matched",
      matchedBy: "label",
    });
  });

  it("never matches a label to Chromium's default stand-in", () => {
    const onlyDefault = [mic("default", "USB Audio Device"), mic("builtin-1", "MacBook Pro Microphone")];
    expect(resolvePreferredInputDevice(onlyDefault, "usb-1", "USB Audio Device")).toMatchObject({
      deviceId: undefined,
      usedFallback: true,
      reason: "not-found",
    });
  });

  it("falls back when there are no input devices at all", () => {
    expect(resolvePreferredInputDevice([], "usb-1", "USB")).toMatchObject({
      deviceId: undefined,
      usedFallback: true,
      reason: "no-devices",
    });
    expect(resolvePreferredInputDevice(null, "usb-1", "USB").reason).toBe("no-devices");
    expect(resolvePreferredInputDevice([mic("spk", "Speakers", "audiooutput")], "usb-1", "USB").reason).toBe(
      "no-devices"
    );
  });

  it("uses the system default without calling it a fallback when nothing is preferred", () => {
    for (const id of ["", undefined, null, "default", "  "]) {
      expect(resolvePreferredInputDevice(DEVICES, id, "")).toEqual({
        deviceId: undefined,
        usedFallback: false,
        reason: "no-preference",
        matchedBy: null,
      });
    }
  });

  it("works with an old stored setting that has an id and no label", () => {
    expect(resolvePreferredInputDevice(DEVICES, "usb-1", undefined)).toMatchObject({
      deviceId: "usb-1",
      matchedBy: "id",
    });
    expect(resolvePreferredInputDevice(DEVICES, "gone", undefined)).toMatchObject({
      deviceId: undefined,
      usedFallback: true,
      reason: "not-found",
    });
  });

  it("tries the stored id when the list hides ids (no permission yet)", () => {
    const hidden = [mic("", ""), mic("", "")];
    expect(resolvePreferredInputDevice(hidden, "usb-1", "USB")).toEqual({
      deviceId: "usb-1",
      usedFallback: false,
      reason: "unverified",
      matchedBy: null,
    });
  });
});

describe("preferenceToStore", () => {
  it("saves the new id when the mic was found by label", () => {
    const resolution = resolvePreferredInputDevice([mic("usb-2", "USB Mic")], "usb-1", "USB Mic");
    expect(preferenceToStore(resolution, "usb-1", "USB Mic")).toEqual({ deviceId: "usb-2", label: "USB Mic" });
  });

  it("fills in the label for a setting saved with an id only", () => {
    const resolution = resolvePreferredInputDevice([mic("usb-1", "USB Mic")], "usb-1", "");
    expect(preferenceToStore(resolution, "usb-1", "")).toEqual({ deviceId: "usb-1", label: "USB Mic" });
  });

  it("saves nothing when the stored pair is right, or on a fallback", () => {
    const devices = [mic("usb-1", "USB Mic")];
    const same = resolvePreferredInputDevice(devices, "usb-1", "USB Mic");
    expect(preferenceToStore(same, "usb-1", "USB Mic")).toBeNull();
    const gone = resolvePreferredInputDevice(devices, "gone", "Gone");
    expect(preferenceToStore(gone, "gone", "Gone")).toBeNull();
    const hidden = resolvePreferredInputDevice([mic("", "")], "usb-1", "USB");
    expect(preferenceToStore(hidden, "usb-1", "USB")).toBeNull();
  });
});

describe("getUserMedia constraints helpers", () => {
  it("knows the errors a missing device gives", () => {
    expect(isMissingDeviceError(namedError("OverconstrainedError"))).toBe(true);
    expect(isMissingDeviceError(namedError("NotFoundError"))).toBe(true);
    expect(isMissingDeviceError(namedError("NotAllowedError"))).toBe(false);
    expect(isMissingDeviceError(null)).toBe(false);
  });

  it("drops only the device choice", () => {
    const constraints = { audio: { deviceId: { exact: "usb-1" }, echoCancellation: false } };
    expect(requestsSpecificDevice(constraints)).toBe(true);
    expect(withoutDeviceId(constraints)).toEqual({ audio: { echoCancellation: false } });
    expect(withoutDeviceId({ audio: { deviceId: { exact: "usb-1" } } })).toEqual({ audio: true });
    const plain = { audio: true };
    expect(requestsSpecificDevice(plain)).toBe(false);
    expect(withoutDeviceId(plain)).toBe(plain);
  });
});

describe("getUserMediaWithFallback", () => {
  const specific = { audio: { deviceId: { exact: "usb-1" }, autoGainControl: false } };

  it("returns the preferred device's stream when it opens", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream("usb"));
    const onFallback = vi.fn();
    await expect(getUserMediaWithFallback(specific, { getUserMedia, onFallback })).resolves.toEqual({ tag: "usb" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it.each(["OverconstrainedError", "NotFoundError"])("retries on the system default after %s", async (name) => {
    const err = namedError(name);
    const getUserMedia = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(fakeStream("default"));
    const onFallback = vi.fn();
    await expect(getUserMediaWithFallback(specific, { getUserMedia, onFallback })).resolves.toEqual({
      tag: "default",
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: { autoGainControl: false } });
    expect(onFallback).toHaveBeenCalledWith(err);
  });

  it("does not retry a permission error", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(namedError("NotAllowedError"));
    await expect(getUserMediaWithFallback(specific, { getUserMedia })).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("does not retry when it already asked for the default", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(namedError("NotFoundError"));
    await expect(getUserMediaWithFallback({ audio: { autoGainControl: false } }, { getUserMedia })).rejects.toMatchObject({
      name: "NotFoundError",
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("throws the default device's error if the retry fails too", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(namedError("OverconstrainedError"))
      .mockRejectedValueOnce(namedError("NotFoundError"));
    await expect(getUserMediaWithFallback(specific, { getUserMedia })).rejects.toMatchObject({
      name: "NotFoundError",
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
