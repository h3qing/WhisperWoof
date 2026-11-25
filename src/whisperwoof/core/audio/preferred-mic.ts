/**
 * The microphone picked in Settings is a preference, not a requirement: when
 * it is plugged in we record from it, and when it isn't we record from the
 * system default instead of failing. Pure rules here; the callers (dictation
 * in `helpers/audioManager.js`, meetings in `hooks/useMeetingTranscription.ts`)
 * enumerate devices and call getUserMedia.
 */

/** The parts of a `MediaDeviceInfo` the rules look at. */
export interface InputDeviceLike {
  deviceId: string;
  label: string;
  kind?: string;
}

export type PreferredMicReason =
  /** No preference stored (or "default"): the system default is the choice, not a fallback. */
  | 'no-preference'
  /** The preferred mic is plugged in. */
  | 'matched'
  /** The device list can't be read (no permission yet): try the stored id, retry on failure. */
  | 'unverified'
  /** Other mics are present, the preferred one isn't. */
  | 'not-found'
  /** No input device is listed at all. */
  | 'no-devices';

export interface PreferredMicResolution {
  /** Pass as `deviceId: { exact }`; undefined means "use the system default". */
  deviceId: string | undefined;
  usedFallback: boolean;
  reason: PreferredMicReason;
  matchedBy: 'id' | 'label' | null;
  /** The matched device's current label, when there is one. */
  label?: string;
}

/** Chromium's stand-ins that follow the OS default; never a specific mic. */
const PSEUDO_DEVICE_IDS = new Set(['default', 'communications']);

function isPseudoDevice(device: InputDeviceLike): boolean {
  return PSEUDO_DEVICE_IDS.has(device.deviceId);
}

/**
 * Which input device to record from. Matches the stored id first; if the id
 * changed (Chromium re-keys devices, e.g. after a reconnect or a profile
 * reset) the stored label finds the same mic. Otherwise: the system default.
 */
export function resolvePreferredInputDevice(
  devices: readonly InputDeviceLike[] | null | undefined,
  preferredId: string | null | undefined,
  preferredLabel?: string | null
): PreferredMicResolution {
  const id = preferredId?.trim() ?? '';
  const label = preferredLabel?.trim() ?? '';

  if (!id || PSEUDO_DEVICE_IDS.has(id)) {
    return { deviceId: undefined, usedFallback: false, reason: 'no-preference', matchedBy: null };
  }

  const inputs = (devices ?? []).filter((d) => !d.kind || d.kind === 'audioinput');
  if (inputs.length === 0) {
    return { deviceId: undefined, usedFallback: true, reason: 'no-devices', matchedBy: null };
  }

  // Without permission Chromium lists inputs with empty ids and labels, so
  // absence can't be told from "not allowed to look". Try the stored id; the
  // getUserMedia retry covers it if it's gone.
  if (inputs.every((d) => !d.deviceId)) {
    return { deviceId: id, usedFallback: false, reason: 'unverified', matchedBy: null };
  }

  const byId = inputs.find((d) => d.deviceId === id);
  if (byId) {
    return {
      deviceId: byId.deviceId,
      usedFallback: false,
      reason: 'matched',
      matchedBy: 'id',
      label: byId.label || undefined,
    };
  }

  if (label) {
    const byLabel = inputs.find((d) => !isPseudoDevice(d) && d.deviceId && d.label.trim() === label);
    if (byLabel) {
      return {
        deviceId: byLabel.deviceId,
        usedFallback: false,
        reason: 'matched',
        matchedBy: 'label',
        label: byLabel.label,
      };
    }
  }

  return { deviceId: undefined, usedFallback: true, reason: 'not-found', matchedBy: null };
}

/**
 * The id and label to save after a match, or null if the stored pair is
 * already right. A label match saves the mic's new id; an id match fills in a
 * label for settings saved before labels were kept.
 */
export function preferenceToStore(
  resolution: PreferredMicResolution,
  preferredId: string | null | undefined,
  preferredLabel?: string | null
): { deviceId: string; label: string } | null {
  if (resolution.reason !== 'matched' || !resolution.deviceId) return null;
  const storedLabel = preferredLabel ?? '';
  const label = resolution.label || storedLabel;
  if (resolution.deviceId === preferredId && label === storedLabel) return null;
  return { deviceId: resolution.deviceId, label };
}

/** Errors getUserMedia gives when the requested device isn't there (current and legacy names). */
const MISSING_DEVICE_ERRORS = new Set([
  'OverconstrainedError',
  'NotFoundError',
  'ConstraintNotSatisfiedError',
  'DevicesNotFoundError',
]);

export function isMissingDeviceError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && MISSING_DEVICE_ERRORS.has(name);
}

function audioConstraintsOf(constraints: MediaStreamConstraints): MediaTrackConstraints | null {
  const audio = constraints.audio;
  return audio && typeof audio === 'object' ? audio : null;
}

/** Whether the constraints ask for one specific input device. */
export function requestsSpecificDevice(constraints: MediaStreamConstraints): boolean {
  return audioConstraintsOf(constraints)?.deviceId !== undefined;
}

/** The same constraints with the device choice removed (the system default). */
export function withoutDeviceId(constraints: MediaStreamConstraints): MediaStreamConstraints {
  const audio = audioConstraintsOf(constraints);
  if (!audio || audio.deviceId === undefined) return constraints;
  const { deviceId: _dropped, ...rest } = audio;
  return { ...constraints, audio: Object.keys(rest).length > 0 ? rest : true };
}

export interface GetUserMediaFallbackOptions {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Called once, before the retry, with the error the specific device gave. */
  onFallback?: (error: unknown) => void;
}

/**
 * getUserMedia for a specific device, retried once on the system default if
 * that device is gone (unplugged between the device check and the call, or a
 * stale cached id). Other errors (permission denied, busy) are thrown as is.
 */
export async function getUserMediaWithFallback(
  constraints: MediaStreamConstraints,
  options: GetUserMediaFallbackOptions = {}
): Promise<MediaStream> {
  const getUserMedia =
    options.getUserMedia ??
    ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
  try {
    return await getUserMedia(constraints);
  } catch (error) {
    if (!requestsSpecificDevice(constraints) || !isMissingDeviceError(error)) throw error;
    options.onFallback?.(error);
    return getUserMedia(withoutDeviceId(constraints));
  }
}
