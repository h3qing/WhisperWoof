import { useCallback, useEffect, useState } from "react";
import modelRegistryData from "../../../models/modelRegistryData.json";
import { useModelDownload } from "../../../hooks/useModelDownload";

// Settings → Transcription → the Qwen3-ASR tab of TranscriptionModelPicker:
// its models' download state, the way the picker keeps Parakeet's.

export interface QwenAsrModelInfo {
  name: string;
  description: string;
  descriptionKey?: string;
  size: string;
  sizeMb: number;
  language: string;
  supportedLanguages: string[];
  recommended?: boolean;
}

export const QWEN_ASR_MODEL_INFO: Record<string, QwenAsrModelInfo> = modelRegistryData.qwenAsrModels;

interface QwenAsrModelStatus {
  model: string;
  downloaded?: boolean;
  size_mb?: number;
}

const notDownloaded = (): QwenAsrModelStatus[] =>
  Object.entries(QWEN_ASR_MODEL_INFO).map(([model, info]) => ({ model, downloaded: false, size_mb: info.sizeMb }));

async function fetchQwenAsrModels(): Promise<QwenAsrModelStatus[] | null> {
  const result = await window.electronAPI?.listQwenAsrModels?.();
  return result?.success ? result.models : null;
}

/** Loads the list once `active` (the tab is open), and again after a download or "Remove models". */
export function useQwenAsrModels(active: boolean) {
  const [models, setModels] = useState<QwenAsrModelStatus[]>(notDownloaded);

  const refresh = useCallback(async () => {
    const next = await fetchQwenAsrModels();
    if (next) setModels(next);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchQwenAsrModels().then((next) => {
      if (next && !cancelled) setModels(next);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    window.addEventListener("openwhispr-models-cleared", refresh);
    return () => window.removeEventListener("openwhispr-models-cleared", refresh);
  }, [refresh]);

  const download = useModelDownload({ modelType: "qwen-asr", onDownloadComplete: refresh });
  return { models, refresh, ...download };
}
