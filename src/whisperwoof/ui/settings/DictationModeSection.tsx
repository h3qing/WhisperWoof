import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Target, Zap, ChevronDown } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { SectionHeader } from "../../../components/ui/SettingsSection";
import { useModelDownload } from "../../../hooks/useModelDownload";
import { useSettingsStore } from "../../../stores/settingsStore";
import { PARAKEET_MODEL_INFO, WHISPER_MODEL_INFO } from "../../../models/ModelRegistry";
import {
  listStreamingModels,
  resolveLiveDictationPlan,
  DEFAULT_LIVE_PREVIEW_MODEL,
  type DictationMode,
  type LiveFinalPass,
} from "../../core/live/live-dictation";

// Settings → Transcription → "How dictation works". Explains the two modes with
// a tiny demo of each, then (live mode) lets the user pick the streaming model
// that types the preview and where the pasted text comes from.

const STREAMING_MODELS = listStreamingModels(PARAKEET_MODEL_INFO);

async function fetchDownloadedParakeetModels(): Promise<ReadonlySet<string> | null> {
  const result = await window.electronAPI?.listParakeetModels?.();
  if (!result?.success) return null;
  return new Set(result.models.filter((m) => m.downloaded).map((m) => m.model));
}

function useDownloadedParakeetModels() {
  const [downloaded, setDownloaded] = useState<ReadonlySet<string>>(new Set());
  const refresh = useCallback(async () => {
    const next = await fetchDownloadedParakeetModels();
    if (next) setDownloaded(next);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchDownloadedParakeetModels().then((next) => {
      if (next && !cancelled) setDownloaded(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { downloaded, refresh };
}

function ModeCard({
  selected,
  icon,
  title,
  description,
  demo,
  onSelect,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  demo: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex-1 min-w-0 flex flex-col items-stretch justify-start text-left rounded-lg border bg-card shadow-card p-3 transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border/60 hover:border-border-hover dark:border-border-subtle"
      }`}
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground/80 leading-snug mt-1 mb-2">{description}</p>
      <div className="mt-auto text-xs rounded-md bg-muted/50 dark:bg-surface-2 px-2 py-1.5 font-medium">
        {demo}
      </div>
    </button>
  );
}

function LiveDemo() {
  return (
    <span className="text-foreground">
      今天下午三点
      <span className="underline decoration-dotted decoration-2 decoration-mando underline-offset-4 text-muted-foreground">
        开个会
      </span>
      <span className="inline-block w-0.5 h-3.5 bg-mando align-[-2px] ml-px animate-pulse" />
    </span>
  );
}

function OptionRow({
  selected,
  title,
  hint,
  onSelect,
  trailing,
}: {
  selected: boolean;
  title: React.ReactNode;
  hint: string;
  onSelect: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/40 rounded-md"
    >
      <div
        className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
          selected ? "border-primary bg-primary" : "border-border-hover dark:border-border-subtle"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground flex items-center gap-1.5 flex-wrap">{title}</div>
        <p className="text-xs text-muted-foreground/70 leading-snug">{hint}</p>
      </div>
      {trailing}
    </div>
  );
}

export default function DictationModeSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const { dictationMode, livePreviewModel, liveFinalPass, useLocalWhisper } = settings;
  const { downloaded, refresh } = useDownloadedParakeetModels();
  const { downloadModel, isDownloadingModel, downloadProgress } = useModelDownload({
    modelType: "parakeet",
    onDownloadComplete: refresh,
  });

  const plan = resolveLiveDictationPlan(
    { ...settings, dictationMode: "live" },
    {
      isOnlineModel: (id) => STREAMING_MODELS.some((m) => m.id === id),
      supportsLanguage: () => true,
    }
  );
  const activePreview = plan.previewModel ?? DEFAULT_LIVE_PREVIEW_MODEL;
  const finalModelName =
    settings.localTranscriptionProvider === "nvidia"
      ? PARAKEET_MODEL_INFO[settings.parakeetModel]?.name ?? settings.parakeetModel
      : WHISPER_MODEL_INFO[settings.whisperModel]?.name ?? settings.whisperModel;
  const [showExplainer, setShowExplainer] = useState(false);

  const setMode = (mode: DictationMode) => settings.setDictationMode(mode);
  const setFinalPass = (pass: LiveFinalPass) => settings.setLiveFinalPass(pass);
  const k = "settingsPage.transcription.dictationMode";

  return (
    <div>
      <SectionHeader
        title={t(`${k}.title`, { defaultValue: "How dictation works" })}
        description={t(`${k}.description`, {
          defaultValue: "Choose whether text appears while you speak or after you finish.",
        })}
      />
      <div role="radiogroup" className="flex gap-2">
        <ModeCard
          selected={dictationMode === "live"}
          icon={<Zap size={14} />}
          title={t(`${k}.live.title`, { defaultValue: "Live typing" })}
          description={t(`${k}.live.description`, {
            defaultValue:
              "See words as you speak. When you release, the text is checked, polished, and pasted.",
          })}
          demo={<LiveDemo />}
          onSelect={() => setMode("live")}
        />
        <ModeCard
          selected={dictationMode !== "live"}
          icon={<Target size={14} />}
          title={t(`${k}.batch.title`, { defaultValue: "After you finish" })}
          description={t(`${k}.batch.description`, {
            defaultValue:
              "Shows a waveform while you speak, then transcribes everything at once. Lightest on your Mac.",
          })}
          demo={<span className="text-muted-foreground">▁▃▅▂▆▃▁ {t(`${k}.batch.demo`, { defaultValue: "Listening…" })}</span>}
          onSelect={() => setMode("batch")}
        />
      </div>

      {dictationMode === "live" && !useLocalWhisper && (
        <p className="text-xs text-warning mt-2">
          {t(`${k}.needsLocal`, {
            defaultValue: "Live typing runs on local models. Switch transcription to Local below to use it.",
          })}
        </p>
      )}

      {dictationMode === "live" && (
        <div className="mt-3 rounded-lg bg-card shadow-card divide-y divide-border/30 dark:divide-border-subtle/50">
          <div className="py-2">
            <p className="px-3 pb-1 text-xs font-semibold text-foreground">
              {t(`${k}.preview.title`, { defaultValue: "Live preview model" })}
            </p>
            {STREAMING_MODELS.map((m) => {
              const isDownloaded = downloaded.has(m.id);
              const downloading = isDownloadingModel(m.id);
              return (
                <OptionRow
                  key={m.id}
                  selected={activePreview === m.id}
                  onSelect={() => settings.setLivePreviewModel(m.id)}
                  title={
                    <>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-[10px] font-semibold px-1.5 rounded-sm bg-success/15 text-success">
                        {t(`${k}.badge.streaming`, { defaultValue: "Streaming" })}
                      </span>
                      <span className="text-xs text-muted-foreground/60 tabular-nums">{m.sizeMb}MB</span>
                      {m.isDefault && (
                        <span className="text-[10px] font-semibold px-1.5 rounded-sm bg-primary/10 text-primary">
                          {t("common.recommended")}
                        </span>
                      )}
                    </>
                  }
                  hint={
                    m.coversChinese
                      ? t(`${k}.preview.zhEn`, { defaultValue: "Chinese + English, with punctuation." })
                      : t(`${k}.preview.noChinese`, {
                          defaultValue: "No Chinese — {{languages}}.",
                          languages: m.languages.slice(0, 6).join(", "),
                        })
                  }
                  trailing={
                    isDownloaded ? null : (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 px-2.5 text-xs shrink-0"
                        disabled={downloading}
                        onClick={(e) => {
                          e.stopPropagation();
                          void downloadModel(m.id, () => settings.setLivePreviewModel(m.id));
                        }}
                      >
                        <Download size={11} className="mr-1" />
                        {downloading
                          ? `${Math.round(downloadProgress.percentage)}%`
                          : t("common.download")}
                      </Button>
                    )
                  }
                />
              );
            })}
            {!downloaded.has(activePreview) && (
              <p className="px-3 pt-1 text-xs text-warning">
                {t(`${k}.preview.needsDownload`, {
                  defaultValue: "Download the preview model to see text while you speak.",
                })}
              </p>
            )}
          </div>

          <div className="py-2">
            <p className="px-3 pb-1 text-xs font-semibold text-foreground">
              {t(`${k}.final.title`, { defaultValue: "Text that gets pasted" })}
            </p>
            <OptionRow
              selected={liveFinalPass !== "preview"}
              onSelect={() => setFinalPass("transcription")}
              title={
                <>
                  {t(`${k}.final.recheck`, { defaultValue: "Re-check with your transcription model" })}
                  <span className="text-xs text-muted-foreground/60">({finalModelName})</span>
                </>
              }
              hint={t(`${k}.final.recheckHint`, {
                defaultValue: "Most accurate. Adds a short wait after you release.",
              })}
            />
            <OptionRow
              selected={liveFinalPass === "preview"}
              onSelect={() => setFinalPass("preview")}
              title={t(`${k}.final.preview`, { defaultValue: "Use the live text as is" })}
              hint={t(`${k}.final.previewHint`, {
                defaultValue: "Fastest. Mistakes in the live text are only fixed by polish.",
              })}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowExplainer((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown size={12} className={showExplainer ? "rotate-180 transition-transform" : "transition-transform"} />
        {t(`${k}.explainer.toggle`, { defaultValue: "What's the difference between the two kinds of models?" })}
      </button>
      {showExplainer && (
        <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs text-muted-foreground/90 leading-relaxed">
          <div className="rounded-md bg-muted/40 dark:bg-surface-2 p-2.5">
            <p className="font-semibold text-foreground mb-0.5">
              {t(`${k}.explainer.streamingTitle`, { defaultValue: "Streaming models" })}
            </p>
            {t(`${k}.explainer.streamingBody`, {
              defaultValue:
                "Hear audio in small slices and guess as they go, so words appear right away. The underlined tail can still change once more context arrives. Small and fast, a bit less accurate.",
            })}
          </div>
          <div className="rounded-md bg-muted/40 dark:bg-surface-2 p-2.5">
            <p className="font-semibold text-foreground mb-0.5">
              {t(`${k}.explainer.batchTitle`, { defaultValue: "Whole-recording models" })}
            </p>
            {t(`${k}.explainer.batchBody`, {
              defaultValue:
                "Wait for the full recording and read it all at once, so every word sees the whole sentence. More accurate, but nothing shows until you release.",
            })}
          </div>
        </div>
      )}
    </div>
  );
}
