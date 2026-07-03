import {
  LOCAL_REASONING_PROVIDER,
  isLocalReasoningProvider,
} from "./local-reasoning-provider";

// Older builds persisted the local model-family id ("qwen", "llama", "mistral",
// "openai-oss", "gemma") into the reasoningProvider setting; those values are
// migrated to the canonical "local" at store init (settingsStore.ts). The main
// process defines local reasoning as reasoningProvider === "local" — any other
// value skips llama-server prewarm and actively stops a running server on every
// settings sync — so keep normalizing at the sync boundary as a safety net for
// un-migrated values (old settings backups, a second window racing the migration).

export interface NormalizedReasoningPrefs {
  reasoningProvider: string;
  reasoningModel: string | undefined;
}

export function normalizeReasoningPrefsForSync(
  reasoningProvider: string,
  reasoningModel: string
): NormalizedReasoningPrefs {
  const isLocal = isLocalReasoningProvider(reasoningProvider);
  return {
    reasoningProvider: isLocal ? LOCAL_REASONING_PROVIDER : reasoningProvider,
    reasoningModel: isLocal ? reasoningModel : undefined,
  };
}
