import modelData from "../../../models/modelRegistryData.json";

// ReasoningModelSelector persists the local model-family id ("qwen", "llama",
// "mistral", "openai-oss", "gemma") into the reasoningProvider setting, but the
// main process defines local reasoning as reasoningProvider === "local": any
// other value skips llama-server prewarm and actively stops a running server on
// every settings sync. Normalize family ids to "local" at the sync boundary.
const LOCAL_PROVIDER_FAMILY_IDS: ReadonlySet<string> = new Set(
  (modelData.localProviders ?? []).map((provider: { id: string }) => provider.id)
);

export interface NormalizedReasoningPrefs {
  reasoningProvider: string;
  reasoningModel: string | undefined;
}

export function normalizeReasoningPrefsForSync(
  reasoningProvider: string,
  reasoningModel: string
): NormalizedReasoningPrefs {
  const isLocal =
    reasoningProvider === "local" || LOCAL_PROVIDER_FAMILY_IDS.has(reasoningProvider);
  return {
    reasoningProvider: isLocal ? "local" : reasoningProvider,
    reasoningModel: isLocal ? reasoningModel : undefined,
  };
}
