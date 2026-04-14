/**
 * ModelChecker — Settings widget that checks if the user is running the best
 * local model their hardware can support.
 *
 * Shows: hardware summary, current vs recommended model, upgrade prompt.
 */

import React, { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import {
  SettingsGroup,
} from "../../../components/ui/SettingsSection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GpuInfo {
  readonly name: string;
  readonly vramMb: number | null;
  readonly vendor: string;
}

interface ModelSpec {
  readonly id: string;
  readonly name: string;
  readonly paramsBillion: number;
  readonly requiredMb: number;
  readonly qualityTier: number;
  readonly description: string;
}

interface CheckResult {
  readonly success: boolean;
  readonly error?: string;
  readonly profile?: {
    readonly ramMb: number;
    readonly ramGb: number;
    readonly cpuCores: number;
    readonly cpuModel: string;
    readonly gpu: GpuInfo;
    readonly isAppleSilicon: boolean;
  };
  readonly recommendation?: {
    readonly recommended: ModelSpec;
    readonly current: ModelSpec | null;
    readonly canUpgrade: boolean;
    readonly upgradeReason: string | null;
    readonly runnable: readonly ModelSpec[];
    readonly memoryBudgetMb: number;
  };
  readonly ollamaAvailable?: boolean;
  readonly installedModels?: readonly string[];
}

interface ModelCheckerProps {
  readonly currentModel: string;
  readonly onSelectModel: (modelId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAPI() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI;
}

function qualityLabel(tier: number): string {
  switch (tier) {
    case 5: return "Excellent";
    case 4: return "Strong";
    case 3: return "Good";
    case 2: return "Basic";
    case 1: return "Minimal";
    default: return "Unknown";
  }
}

function qualityColor(tier: number): string {
  switch (tier) {
    case 5: return "text-emerald-600 dark:text-emerald-400";
    case 4: return "text-blue-600 dark:text-blue-400";
    case 3: return "text-amber-600 dark:text-amber-400";
    case 2: return "text-orange-600 dark:text-orange-400";
    case 1: return "text-muted-foreground";
    default: return "text-muted-foreground";
  }
}

function qualityDots(tier: number): string {
  const filled = tier;
  const empty = 5 - tier;
  return "\u25CF".repeat(filled) + "\u25CB".repeat(empty);
}

function gpuLabel(gpu: GpuInfo): string {
  if (gpu.vendor === "apple-silicon") return gpu.name;
  if (gpu.vendor === "nvidia" && gpu.vramMb) return `${gpu.name} (${Math.round(gpu.vramMb / 1024)} GB)`;
  if (gpu.vendor === "amd" && gpu.vramMb) return `${gpu.name} (${Math.round(gpu.vramMb / 1024)} GB)`;
  return gpu.name;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ModelChecker({ currentModel, onSelectModel }: ModelCheckerProps) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const res = await getAPI().whisperwoofCheckLocalModel(currentModel || null);
      setResult(res);
    } catch {
      setResult({ success: false, error: "Failed to check hardware" });
    } finally {
      setChecking(false);
    }
  }, [currentModel]);

  const handleApplyRecommendation = useCallback(() => {
    if (result?.recommendation?.recommended) {
      onSelectModel(result.recommendation.recommended.id);
    }
  }, [result, onSelectModel]);

  // Not yet checked — show the check button
  if (!result) {
    return (
      <SettingsGroup>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Am I using the best model?</p>
            <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">
              Check your hardware and see if a better local model is available.
            </p>
          </div>
          <button
            onClick={runCheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium text-foreground border border-border/50 dark:border-white/10 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50 shrink-0"
          >
            {checking ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Checking...
              </>
            ) : (
              "Check Hardware"
            )}
          </button>
        </div>
      </SettingsGroup>
    );
  }

  // Check failed
  if (!result.success) {
    return (
      <SettingsGroup>
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Model Check</p>
          <p className="text-xs text-red-500 dark:text-red-400">
            Could not detect hardware: {result.error}
          </p>
          <button
            onClick={runCheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium text-foreground border border-border/50 dark:border-white/10 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : null}
            Retry
          </button>
        </div>
      </SettingsGroup>
    );
  }

  const { profile, recommendation, ollamaAvailable, installedModels } = result;

  return (
    <SettingsGroup>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Model Check</p>
          <button
            onClick={runCheck}
            disabled={checking}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {checking ? "Checking..." : "Re-check"}
          </button>
        </div>

        {/* Hardware summary */}
        {profile && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="text-muted-foreground">RAM</div>
            <div className="text-foreground font-mono">{profile.ramGb} GB</div>
            <div className="text-muted-foreground">CPU</div>
            <div className="text-foreground font-mono truncate" title={profile.cpuModel}>
              {profile.cpuCores} cores
            </div>
            <div className="text-muted-foreground">GPU</div>
            <div className="text-foreground font-mono truncate" title={profile.gpu.name}>
              {gpuLabel(profile.gpu)}
            </div>
            {recommendation && (
              <>
                <div className="text-muted-foreground">Model budget</div>
                <div className="text-foreground font-mono">
                  {(recommendation.memoryBudgetMb / 1024).toFixed(1)} GB
                </div>
              </>
            )}
          </div>
        )}

        {/* Ollama status */}
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${ollamaAvailable ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
          <span className="text-[11px] text-muted-foreground">
            {ollamaAvailable
              ? `Ollama running (${installedModels?.length ?? 0} model${(installedModels?.length ?? 0) !== 1 ? "s" : ""} installed)`
              : "Ollama not detected"}
          </span>
        </div>

        {/* Recommendation */}
        {recommendation && (
          <div className="space-y-2">
            {/* Current model */}
            {recommendation.current ? (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Current model</span>
                <span className="text-foreground">
                  {recommendation.current.name}
                  <span className={`ml-1.5 ${qualityColor(recommendation.current.qualityTier)}`}>
                    {qualityDots(recommendation.current.qualityTier)}
                  </span>
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Current model</span>
                <span className="text-foreground font-mono">{currentModel || "none"}</span>
              </div>
            )}

            {/* Recommended model */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Recommended</span>
              <span className="text-foreground">
                {recommendation.recommended.name}
                <span className={`ml-1.5 ${qualityColor(recommendation.recommended.qualityTier)}`}>
                  {qualityDots(recommendation.recommended.qualityTier)}
                </span>
              </span>
            </div>

            {/* Quality label */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Quality</span>
              <span className={qualityColor(recommendation.recommended.qualityTier)}>
                {qualityLabel(recommendation.recommended.qualityTier)}
              </span>
            </div>

            {/* Upgrade prompt */}
            {recommendation.canUpgrade && recommendation.upgradeReason ? (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/30 p-2.5 space-y-2">
                <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {recommendation.upgradeReason}
                </p>
                <button
                  onClick={handleApplyRecommendation}
                  className="inline-flex items-center h-6 px-2.5 rounded text-[11px] font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                >
                  Use {recommendation.recommended.name}
                </button>
              </div>
            ) : (
              <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/50 dark:border-emerald-800/30 p-2.5">
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                  You're using the best model for your hardware.
                </p>
              </div>
            )}

            {/* Runnable models list */}
            {recommendation.runnable.length > 1 && (
              <details className="group">
                <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                  All compatible models ({recommendation.runnable.length})
                </summary>
                <div className="mt-1.5 space-y-1">
                  {recommendation.runnable.map((m) => {
                    const isInstalled = installedModels?.some(
                      (im) => im.replace(/:latest$/, "") === m.id
                    );
                    const isCurrent = m.id === recommendation.current?.id;
                    const isRecommended = m.id === recommendation.recommended.id;

                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-[11px] py-0.5"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-foreground truncate">{m.name}</span>
                          {isCurrent && (
                            <span className="shrink-0 text-[10px] px-1 py-px rounded bg-foreground/10 text-muted-foreground">
                              current
                            </span>
                          )}
                          {isRecommended && !isCurrent && (
                            <span className="shrink-0 text-[10px] px-1 py-px rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                              best
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={qualityColor(m.qualityTier)}>
                            {qualityDots(m.qualityTier)}
                          </span>
                          {isInstalled ? (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                              installed
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/50">
                              not pulled
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}
