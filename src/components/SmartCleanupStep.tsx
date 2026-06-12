import React, { useCallback, useEffect, useState } from "react";
import { Sparkles, Check, Download, Loader2, X } from "lucide-react";
import { Button } from "./ui/button";
import { useModelDownload } from "../hooks/useModelDownload";
import { useSettings } from "../hooks/useSettings";
import logger from "../utils/logger";

// Recommended local cleanup model: small enough to download quickly and run
// sub-second on Apple Silicon, capable enough for filler removal + grammar.
const MODEL_ID = "qwen3.5-2b-q4_k_m";
const MODEL_LABEL = "Qwen 2B";
const MODEL_SIZE = "1.3 GB";

function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

export default function SmartCleanupStep() {
  const {
    reasoningModel,
    useReasoningModel,
    setReasoningModel,
    setUseReasoningModel,
    setReasoningProvider,
  } = useSettings();

  const [downloaded, setDownloaded] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const all = (await window.electronAPI?.modelGetAll?.()) as
        | Array<{ id: string; isDownloaded?: boolean }>
        | undefined;
      const match = Array.isArray(all) ? all.find((m) => m.id === MODEL_ID) : null;
      setDownloaded(!!match?.isDownloaded);
    } catch (error) {
      logger.error("Failed to check cleanup model status", { error }, "onboarding");
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const { downloadModel, downloadProgress, isDownloadingModel, isInstalling, cancelDownload } =
    useModelDownload({ modelType: "llm", onDownloadComplete: refreshStatus });

  const downloading = isDownloadingModel(MODEL_ID);
  const enabled = useReasoningModel && reasoningModel === MODEL_ID;

  const enable = useCallback(() => {
    setReasoningProvider("local");
    setReasoningModel(MODEL_ID);
    setUseReasoningModel(true);
  }, [setReasoningProvider, setReasoningModel, setUseReasoningModel]);

  const handlePrimary = useCallback(async () => {
    if (downloaded) {
      enable();
      return;
    }
    await downloadModel(MODEL_ID, () => enable());
  }, [downloaded, enable, downloadModel]);

  return (
    <div className="space-y-4">
      <div className="text-center space-y-0.5">
        <div className="w-12 h-12 bg-[#A06A3C]/10 rounded-full flex items-center justify-center mx-auto mb-2">
          <Sparkles className="w-6 h-6 text-[#A06A3C]" />
        </div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">Smart Cleanup</h2>
        <p className="text-xs text-muted-foreground">
          Polish your dictation as you speak — 100% on your Mac.
        </p>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-1 p-4 space-y-3">
        <ul className="space-y-1.5 text-sm text-foreground/90">
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" /> Removes “um”, “uh”, and false
            starts
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" /> Fixes grammar, punctuation, and
            capitalization
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" /> Formats lists and keeps your
            voice
          </li>
        </ul>

        <div className="pt-1 border-t border-border-subtle">
          {enabled ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 pt-2">
              <Check className="w-4 h-4" />
              <span>
                Smart Cleanup is on — using {MODEL_LABEL}, running locally.
              </span>
            </div>
          ) : downloading || isInstalling ? (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {isInstalling
                    ? "Installing…"
                    : `Downloading ${MODEL_LABEL}… ${downloadProgress.percentage}%`}
                </span>
                {!isInstalling && downloadProgress.totalBytes > 0 && (
                  <span>
                    {formatMb(downloadProgress.downloadedBytes)} /{" "}
                    {formatMb(downloadProgress.totalBytes)}
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#A06A3C] transition-[width] duration-200"
                  style={{ width: `${isInstalling ? 100 : downloadProgress.percentage}%` }}
                />
              </div>
              {!isInstalling && (
                <button
                  onClick={cancelDownload}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between pt-2 gap-3">
              <span className="text-xs text-muted-foreground">
                {downloaded
                  ? `${MODEL_LABEL} is ready`
                  : `Recommended: ${MODEL_LABEL} · ${MODEL_SIZE} one-time download`}
              </span>
              <Button onClick={handlePrimary} className="h-8 px-4 rounded-full text-xs shrink-0">
                {downloaded ? (
                  <>Enable</>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" /> Download &amp; enable
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground/70">
        Optional — you can skip this and turn it on later in Settings → Intelligence.
      </p>
    </div>
  );
}
