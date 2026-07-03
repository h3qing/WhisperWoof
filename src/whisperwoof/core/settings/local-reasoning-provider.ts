import modelData from "../../../models/modelRegistryData.json";

// The canonical reasoningProvider value for on-device polish is "local".
// Historically ReasoningModelSelector persisted the local model-family id
// ("qwen", "llama", "mistral", "openai-oss", "gemma") instead, which broke
// every consumer that keys on exactly "local" (llama-server prewarm, the
// home-screen privacy pill). The family id is purely UI state — which tab of
// the local model picker is open — and lives in its own localStorage key.
export const LOCAL_REASONING_PROVIDER = "local";
export const LOCAL_FAMILY_STORAGE_KEY = "reasoningLocalFamily";
// The agent-mode selector binds to agentProvider/agentModel and keeps its own
// tab preference so the two pickers can't overwrite each other's memory.
export const AGENT_LOCAL_FAMILY_STORAGE_KEY = "agentLocalFamily";
export const DEFAULT_LOCAL_FAMILY = "qwen";

const LOCAL_PROVIDER_FAMILY_IDS: ReadonlySet<string> = new Set(
  (modelData.localProviders ?? []).map((provider: { id: string }) => provider.id)
);

const MODEL_ID_TO_FAMILY: ReadonlyMap<string, string> = new Map(
  (modelData.localProviders ?? []).flatMap((provider: { id: string; models?: { id: string }[] }) =>
    (provider.models ?? []).map((model): [string, string] => [model.id, provider.id])
  )
);

export function isLocalProviderFamilyId(value: string): boolean {
  return LOCAL_PROVIDER_FAMILY_IDS.has(value);
}

// True for the canonical "local" AND for stale family ids, so readers stay
// correct even if an un-migrated value slips through (old settings backup,
// second window racing the migration).
export function isLocalReasoningProvider(value: string): boolean {
  return value === LOCAL_REASONING_PROVIDER || isLocalProviderFamilyId(value);
}

export interface StaleReasoningProviderMigration {
  reasoningProvider: string;
  localFamily: string;
}

// One-time localStorage migration: a stored family id becomes "local", and the
// family id moves to the tab key (unless the user already has a valid tab).
// Returns null when nothing needs to change.
export function migrateStaleReasoningProvider(
  storedProvider: string | null,
  storedFamily: string | null
): StaleReasoningProviderMigration | null {
  if (!storedProvider || !isLocalProviderFamilyId(storedProvider)) return null;
  return {
    reasoningProvider: LOCAL_REASONING_PROVIDER,
    localFamily:
      storedFamily && isLocalProviderFamilyId(storedFamily) ? storedFamily : storedProvider,
  };
}

// Which family tab the local model picker should open on. A stale family id in
// the provider setting wins (pre-migration behavior, still used by the agent
// selector's separate provider setting); otherwise the selected model's family;
// otherwise the persisted tab; otherwise the default.
export function resolveLocalFamilyTab(
  reasoningProvider: string,
  selectedModel: string,
  persistedFamily: string | null
): string {
  if (isLocalProviderFamilyId(reasoningProvider)) return reasoningProvider;
  const familyFromModel = MODEL_ID_TO_FAMILY.get(selectedModel);
  if (familyFromModel) return familyFromModel;
  if (persistedFamily && isLocalProviderFamilyId(persistedFamily)) return persistedFamily;
  return DEFAULT_LOCAL_FAMILY;
}
