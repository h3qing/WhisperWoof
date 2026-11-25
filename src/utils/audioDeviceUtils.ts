/**
 * Utility functions for audio device detection and management.
 * Shared between renderer components and audio manager.
 */

import {
  preferenceToStore,
  resolvePreferredInputDevice,
  type InputDeviceLike,
  type PreferredMicResolution,
} from "../whisperwoof/core/audio/preferred-mic";

export interface PreferredMicSettings {
  selectedMicDeviceId: string;
  selectedMicDeviceLabel?: string;
  setSelectedMicDevice?: (deviceId: string, label: string) => void;
}

/**
 * Which mic the preferred-mic setting means right now (undefined deviceId:
 * the system default). Lists devices unless `devices` is given, and saves the
 * mic's new id (or a missing label) when it was found by label.
 */
export async function resolvePreferredMicrophone(
  settings: PreferredMicSettings,
  devices?: readonly InputDeviceLike[]
): Promise<PreferredMicResolution> {
  const { selectedMicDeviceId: id, selectedMicDeviceLabel: label = "" } = settings;
  let list = devices;
  if (!list) {
    try {
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {
      // Can't look: try the stored id; getUserMediaWithFallback covers a missing one.
      list = [{ deviceId: "", label: "", kind: "audioinput" }];
    }
  }
  const resolution = resolvePreferredInputDevice(list, id, label);
  const update = preferenceToStore(resolution, id, label);
  if (update) settings.setSelectedMicDevice?.(update.deviceId, update.label);
  return resolution;
}

/**
 * Determines if a microphone device is a built-in device based on its label.
 * Works across macOS, Windows, and Linux platforms.
 */
export function isBuiltInMicrophone(label: string): boolean {
  const lowerLabel = label.toLowerCase();

  // Direct built-in indicators
  if (
    lowerLabel.includes("built-in") ||
    lowerLabel.includes("internal") ||
    lowerLabel.includes("macbook") ||
    lowerLabel.includes("integrated") ||
    lowerLabel.includes("laptop") ||
    lowerLabel.includes("default") // WhisperWoof: catch "Default" labeled devices
  ) {
    return true;
  }

  // macOS-specific patterns (Apple Silicon Macs)
  if (
    lowerLabel.includes("macbook") ||
    lowerLabel.includes("imac") ||
    lowerLabel.includes("mac mini") ||
    lowerLabel.includes("mac studio") ||
    lowerLabel.includes("mac pro")
  ) {
    return true;
  }

  // Generic "microphone" without external device indicators
  if (lowerLabel.includes("microphone") || lowerLabel.includes("mic")) {
    const externalIndicators = [
      "bluetooth",
      "airpods",
      "wireless",
      "usb",
      "external",
      "headset",
      "webcam",
      "iphone",
      "ipad",
      "beats",
      "jabra",
      "logitech",
      "blue yeti",
      "rode",
      "audio-technica",
      "samsung",
      "sony",
    ];
    return !externalIndicators.some((indicator) => lowerLabel.includes(indicator));
  }

  return false;
}
