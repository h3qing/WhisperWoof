// The on-device pair WhisperWoof recommends and gives new users: Whisper Turbo
// for speech-to-text (multilingual, handles Chinese + English) and Qwen3.5 2B
// for cleanup (1.3 GB, sub-second on Apple Silicon). The registry's
// `recommended` flags, the settings default and the onboarding cleanup step
// all follow these ids (recommended-models.test.ts keeps them in step).
export const RECOMMENDED_WHISPER_MODEL = "turbo";
export const RECOMMENDED_CLEANUP_MODEL = "qwen3.5-2b-q4_k_m";

interface PickableModel {
  id: string;
  recommended?: boolean;
}

// The model a local family tab switches to on its own: the recommended one if
// it's downloaded, else the first downloaded one, else none ("" = no cleanup
// until the user downloads a model).
export function pickDownloadedLocalModel(
  models: readonly PickableModel[],
  downloaded: ReadonlySet<string>
): string {
  const available = models.filter((m) => downloaded.has(m.id));
  return (available.find((m) => m.recommended) ?? available[0])?.id ?? "";
}
