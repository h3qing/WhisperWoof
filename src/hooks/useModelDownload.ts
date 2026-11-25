import { useState, useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./useDialogs";
import { useToast } from "../components/ui/Toast";
import type { WhisperDownloadProgressData } from "../types/electron";
import "../types/electron";

const PROGRESS_THROTTLE_MS = 100;

export interface DownloadProgress {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speed?: number;
  eta?: number;
}

export type ModelType = "whisper" | "llm" | "parakeet" | "qwen-asr";

// Qwen3-ASR's IPC mirrors Parakeet's (same result and progress shapes).
function sherpaLikeApi(modelType: ModelType) {
  const api = window.electronAPI;
  return modelType === "qwen-asr"
    ? {
        download: (id: string) => api?.downloadQwenAsrModel(id),
        remove: (id: string) => api?.deleteQwenAsrModel(id),
        cancel: () => api?.cancelQwenAsrDownload(),
        onProgress: api?.onQwenAsrDownloadProgress,
      }
    : {
        download: (id: string) => api?.downloadParakeetModel(id),
        remove: (id: string) => api?.deleteParakeetModel(id),
        cancel: () => api?.cancelParakeetDownload(),
        onProgress: api?.onParakeetDownloadProgress,
      };
}

interface UseModelDownloadOptions {
  modelType: ModelType;
  onDownloadComplete?: () => void;
  onModelsCleared?: () => void;
}

interface LLMDownloadProgressData {
  modelId: string;
  progress: number;
  downloadedSize: number;
  totalSize: number;
}

export function formatETA(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function getDownloadErrorMessage(t: TFunction, error: string, code?: string): string {
  if (code === "EXTRACTION_FAILED" || error.includes("installation failed"))
    return t("hooks.modelDownload.errors.extractionFailed");
  if (code === "ETIMEDOUT" || error.includes("timeout") || error.includes("stalled"))
    return t("hooks.modelDownload.errors.timeout");
  if (code === "ENOTFOUND" || error.includes("ENOTFOUND"))
    return t("hooks.modelDownload.errors.notFound");
  if (error.includes("disk space")) return error;
  if (error.includes("corrupted") || error.includes("incomplete") || error.includes("too small"))
    return t("hooks.modelDownload.errors.corrupted");
  if (error.includes("HTTP 429") || error.includes("rate limit"))
    return t("hooks.modelDownload.errors.rateLimited");
  if (error.includes("HTTP 4") || error.includes("HTTP 5"))
    return t("hooks.modelDownload.errors.server", { error });
  return t("hooks.modelDownload.errors.generic", { error });
}

export function useModelDownload({
  modelType,
  onDownloadComplete,
  onModelsCleared,
}: UseModelDownloadOptions) {
  const { t } = useTranslation();
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isCancellingRef = useRef(false);
  const lastProgressUpdateRef = useRef(0);

  const { showAlertDialog } = useDialogs();
  const { toast } = useToast();
  const showAlertDialogRef = useRef(showAlertDialog);
  const onDownloadCompleteRef = useRef(onDownloadComplete);
  const onModelsClearedRef = useRef(onModelsCleared);

  useEffect(() => {
    showAlertDialogRef.current = showAlertDialog;
  }, [showAlertDialog]);

  useEffect(() => {
    onDownloadCompleteRef.current = onDownloadComplete;
  }, [onDownloadComplete]);

  useEffect(() => {
    onModelsClearedRef.current = onModelsCleared;
  }, [onModelsCleared]);

  useEffect(() => {
    const handleModelsCleared = () => onModelsClearedRef.current?.();
    window.addEventListener("openwhispr-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("openwhispr-models-cleared", handleModelsCleared);
  }, []);

  const handleWhisperProgress = useCallback(
    (_event: unknown, data: WhisperDownloadProgressData) => {
      if (data.type === "progress") {
        const now = Date.now();
        if (now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) return;
        lastProgressUpdateRef.current = now;
        // WhisperWoof: never let progress go backwards (prevents regression visual glitch)
        setDownloadProgress((prev) => {
          const newPct = data.percentage || 0;
          const newBytes = data.downloaded_bytes || 0;
          // Only update if progress moved forward (or is at 0 for a new download)
          if (newPct < prev.percentage && prev.percentage > 5 && newPct > 0) {
            return prev; // Skip regressive update
          }
          return {
            percentage: Math.max(prev.percentage, newPct),
            downloadedBytes: Math.max(prev.downloadedBytes, newBytes),
            totalBytes: data.total_bytes || prev.totalBytes || 0,
          };
        });
      } else if (data.type === "installing") {
        setIsInstalling(true);
      } else if (data.type === "complete") {
        if (isCancellingRef.current) return;
        setIsInstalling(false);
        // Don't clear downloadingModel/downloadProgress here — let downloadModel's
        // finally block handle it after the model list has been refreshed.
        // This prevents a flash where the model appears "not downloaded".
      } else if (data.type === "error") {
        if (isCancellingRef.current) return;
        const msg = getDownloadErrorMessage(
          t,
          data.error || t("hooks.modelDownload.errors.unknown"),
          data.code
        );
        const title =
          data.code === "EXTRACTION_FAILED"
            ? t("hooks.modelDownload.installationFailed.title")
            : t("hooks.modelDownload.downloadFailed.title");
        setDownloadError(msg);
        showAlertDialogRef.current({ title, description: msg });
        setIsInstalling(false);
        setDownloadingModel(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      }
    },
    [t]
  );

  const handleLLMProgress = useCallback((_event: unknown, data: LLMDownloadProgressData) => {
    if (isCancellingRef.current) return;

    const now = Date.now();
    const isComplete = data.progress >= 100;
    if (!isComplete && now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) {
      return;
    }
    lastProgressUpdateRef.current = now;

    setDownloadProgress({
      percentage: data.progress || 0,
      downloadedBytes: data.downloadedSize || 0,
      totalBytes: data.totalSize || 0,
    });
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;

    if (modelType === "whisper") {
      dispose = window.electronAPI?.onWhisperDownloadProgress(handleWhisperProgress);
    } else if (modelType === "parakeet" || modelType === "qwen-asr") {
      dispose = sherpaLikeApi(modelType).onProgress?.(handleWhisperProgress);
    } else {
      dispose = window.electronAPI?.onModelDownloadProgress(handleLLMProgress);
    }

    return () => {
      dispose?.();
    };
  }, [handleWhisperProgress, handleLLMProgress, modelType]);

  const downloadModel = useCallback(
    async (modelId: string, onSelectAfterDownload?: (id: string) => void) => {
      if (downloadingModel) {
        toast({
          title: t("hooks.modelDownload.downloadInProgress.title"),
          description: t("hooks.modelDownload.downloadInProgress.description"),
        });
        return;
      }

      try {
        setDownloadingModel(modelId);
        setDownloadError(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
        lastProgressUpdateRef.current = 0; // Reset throttle timer

        let success = false;

        if (modelType === "whisper") {
          const result = await window.electronAPI?.downloadWhisperModel(modelId);
          if (!result?.success && !result?.error?.includes("interrupted by user")) {
            const msg = getDownloadErrorMessage(
              t,
              result?.error || t("hooks.modelDownload.errors.unknown"),
              result?.code
            );
            setDownloadError(msg);
            showAlertDialog({
              title: t("hooks.modelDownload.downloadFailed.title"),
              description: msg,
            });
          } else {
            success = result?.success ?? false;
          }
        } else if (modelType === "parakeet" || modelType === "qwen-asr") {
          const result = await sherpaLikeApi(modelType).download(modelId);
          if (!result?.success && !result?.error?.includes("interrupted by user")) {
            const msg = getDownloadErrorMessage(
              t,
              result?.error || t("hooks.modelDownload.errors.unknown"),
              result?.code
            );
            const title =
              result?.code === "EXTRACTION_FAILED"
                ? t("hooks.modelDownload.installationFailed.title")
                : t("hooks.modelDownload.downloadFailed.title");
            setDownloadError(msg);
            showAlertDialog({ title, description: msg });
          } else {
            success = result?.success ?? false;
          }
        } else {
          const result = (await window.electronAPI?.modelDownload?.(modelId)) as unknown as
            | { success: boolean; error?: string; code?: string }
            | undefined;
          if (result && !result.success && result.error) {
            const msg = getDownloadErrorMessage(t, result.error, result.code);
            setDownloadError(msg);
            showAlertDialog({
              title: t("hooks.modelDownload.downloadFailed.title"),
              description: msg,
            });
          } else {
            success = result?.success ?? false;
          }
        }

        if (success) {
          onSelectAfterDownload?.(modelId);
        }

        // Await the refresh so the model list is updated before we clear
        // the downloading state in `finally`. This prevents a flash where
        // the model briefly appears "not downloaded".
        try {
          await onDownloadCompleteRef.current?.();
        } catch {
          // Non-fatal — the model is on disk regardless
        }
      } catch (error: unknown) {
        if (isCancellingRef.current) return;

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          !errorMessage.includes("interrupted by user") &&
          !errorMessage.includes("cancelled by user") &&
          !errorMessage.includes("DOWNLOAD_CANCELLED")
        ) {
          const msg = getDownloadErrorMessage(t, errorMessage);
          setDownloadError(msg);
          showAlertDialog({
            title: t("hooks.modelDownload.downloadFailed.title"),
            description: msg,
          });
        }
      } finally {
        setIsInstalling(false);
        setDownloadingModel(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      }
    },
    [downloadingModel, modelType, showAlertDialog, toast, t]
  );

  const deleteModel = useCallback(
    async (modelId: string, onComplete?: () => void) => {
      try {
        if (modelType === "whisper") {
          const result = await window.electronAPI?.deleteWhisperModel(modelId);
          if (result?.success) {
            toast({
              title: t("hooks.modelDownload.modelDeleted.title"),
              description: t("hooks.modelDownload.modelDeleted.descriptionWithSpace", {
                sizeMb: result.freed_mb,
              }),
            });
          }
        } else if (modelType === "parakeet" || modelType === "qwen-asr") {
          const result = await sherpaLikeApi(modelType).remove(modelId);
          if (result?.success) {
            toast({
              title: t("hooks.modelDownload.modelDeleted.title"),
              description: t("hooks.modelDownload.modelDeleted.descriptionWithSpace", {
                sizeMb: result.freed_mb,
              }),
            });
          }
        } else {
          await window.electronAPI?.modelDelete?.(modelId);
          toast({
            title: t("hooks.modelDownload.modelDeleted.title"),
            description: t("hooks.modelDownload.modelDeleted.description"),
          });
        }
        onComplete?.();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        showAlertDialog({
          title: t("hooks.modelDownload.deleteFailed.title"),
          description: t("hooks.modelDownload.deleteFailed.description", { error: errorMessage }),
        });
      }
    },
    [modelType, toast, showAlertDialog, t]
  );

  const cancelDownload = useCallback(async () => {
    if (!downloadingModel || isCancelling) return;

    setIsCancelling(true);
    isCancellingRef.current = true;
    try {
      if (modelType === "whisper") {
        await window.electronAPI?.cancelWhisperDownload();
      } else if (modelType === "parakeet" || modelType === "qwen-asr") {
        await sherpaLikeApi(modelType).cancel();
      } else {
        await window.electronAPI?.modelCancelDownload?.(downloadingModel);
      }
      toast({
        title: t("hooks.modelDownload.downloadCancelled.title"),
        description: t("hooks.modelDownload.downloadCancelled.description"),
      });
    } catch (error) {
      console.error("Failed to cancel download:", error);
    } finally {
      setIsCancelling(false);
      isCancellingRef.current = false;
      setDownloadingModel(null);
      setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      onDownloadCompleteRef.current?.();
    }
  }, [downloadingModel, isCancelling, modelType, toast, t]);

  const isDownloading = downloadingModel !== null;
  const isDownloadingModel = useCallback(
    (modelId: string) => downloadingModel === modelId,
    [downloadingModel]
  );

  return {
    downloadingModel,
    downloadProgress,
    downloadError,
    isDownloading,
    isDownloadingModel,
    isInstalling,
    isCancelling,
    downloadModel,
    deleteModel,
    cancelDownload,
    formatETA,
  };
}
