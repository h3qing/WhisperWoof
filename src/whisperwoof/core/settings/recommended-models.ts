// The on-device pair WhisperWoof recommends and gives new users: Whisper Turbo
// for speech-to-text (multilingual, handles Chinese + English) and Gemma 4 E4B
// for cleanup (4.6 GB, sub-second on Apple Silicon; unlike Qwen3.5 2B it never
// translated English words into Chinese, see eval/real-dictation/RESULTS.md).
// The registry's `recommended` flags, the settings default and the onboarding
// cleanup step all follow these ids (recommended-models.test.ts keeps them in
// step).
export const RECOMMENDED_WHISPER_MODEL = "turbo";
export const RECOMMENDED_CLEANUP_MODEL = "gemma-4-e4b-it-q4_0";

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
