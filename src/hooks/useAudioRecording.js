import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { getSettings } from "../stores/settingsStore";
import { getRecordingErrorTitle } from "../utils/recordingErrors";
import { LatencyTracker } from "../whisperwoof/core/latency/latency-tracker";
import { PERCEIVED_LATENCY_BUDGET_MS } from "../whisperwoof/core/latency/types";
import { EMPTY_LIVE_SEGMENTS, toLiveSegments } from "../whisperwoof/core/live/live-dictation";
import { NOTICE_MS, noticeExcerpt } from "../whisperwoof/core/indicator/notices";
import { copyTextFromOverlay } from "../whisperwoof/core/router/copy-to-clipboard";
import { routeForHotkey } from "../whisperwoof/core/router/dictation-route";
import {
  MIXED_LANGUAGE_TIP_KEY,
  shouldShowMixedLanguageTip,
} from "../whisperwoof/core/language/auto-language-note";

// How long the live panel keeps showing the pasted text before it collapses.
const LIVE_DONE_HOLD_MS = 1600;
// How long Mando shows he didn't hear anything after a capture with no voice.
const HEARD_NOTHING_HOLD_MS = 2200;

// Anything the overlay says goes through `notify` (core/indicator/notices.ts):
// Mando says it in the live panel's capsule once the overlay is free.

export const useAudioRecording = (notify, options = {}) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  // "idle" | "transcribing" | "polishing" — drives the indicator's phase label.
  const [processingPhase, setProcessingPhase] = useState("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  // Live dictation: committed/provisional split of the stream, whether this
  // capture runs in live mode, and the pasted text held briefly afterwards.
  const [liveSegments, setLiveSegments] = useState(EMPTY_LIVE_SEGMENTS);
  const [isLiveMode, setIsLiveMode] = useState(false);
  // Read from the completion callback, where the state value would be stale.
  const isLiveModeRef = useRef(false);
  // Where this dictation goes (Fn+T copy, Fn+N note, …), known the moment the
  // letter is pressed so the overlay can say so before release.
  const [dictationRoute, setDictationRoute] = useState("paste-at-cursor");
  const [liveFinalText, setLiveFinalText] = useState("");
  // Why this live capture shows no words (preview model missing, stream
  // failed), or null. The panel says so; the capture still pastes on release.
  const [liveNotice, setLiveNotice] = useState(null);
  // True from the hotkey press until recording actually starts (mic open takes
  // 100-500ms), so the live panel can show "Listening" instead of the idle icon.
  const [isStarting, setIsStarting] = useState(false);
  // True for a moment after a capture that had nobody talking in it: nothing
  // was typed, and the indicator says so (Mando tilts his head).
  const [heardNothing, setHeardNothing] = useState(false);
  const liveDoneTimerRef = useRef(null);
  const heardNothingTimerRef = useRef(null);
  const audioManagerRef = useRef(null);
  const startLockRef = useRef(false);
  const stopLockRef = useRef(false);
  const activeHotkeyRef = useRef(null); // Hotkey combo used during this dictation (e.g. "Fn+T")
  // WhisperWoof: per-capture latency tracker. Created on hotkey down,
  // marked through each pipeline stage, finalized + persisted to
  // bf_entries.metadata.timings when the capture completes.
  const latencyTrackerRef = useRef(null);
  const { onToggle } = options;

  const performStartRecording = useCallback(async () => {
    if (startLockRef.current) return false;
    startLockRef.current = true;
    setIsStarting(true);
    setLiveNotice(null);
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording || currentState.isProcessing) return false;

      // WhisperWoof latency: start the tracker at the very first moment
      // we know the user is trying to record. `hotkey` is marked now,
      // `micOpen` lands a few ms later once startRecording returns true.
      const tracker = new LatencyTracker();
      tracker.mark("hotkey");
      latencyTrackerRef.current = tracker;

      // Retry STT config fetch if it wasn't loaded on mount (e.g. auth wasn't ready)
      if (!audioManagerRef.current.sttConfig) {
        const config = await window.electronAPI.getSttConfig?.();
        if (config?.success) {
          audioManagerRef.current.setSttConfig(config);
        }
      }

      const result = audioManagerRef.current.shouldUseStreaming()
        ? await audioManagerRef.current.startStreamingRecording()
        : await audioManagerRef.current.startRecording();

      // Result is either `false` (didn't start) or `{ success: true, micAcquiredAt, micOpenAt? }`
      const didStart = result && result.success;

      if (didStart) {
        // Mark micAcquired with the precise timestamp from audioManager
        // (captured right after getUserMedia resolved, before pipeline setup).
        // In streaming mode, onMicReady may have already marked this.
        if (result.micAcquiredAt != null && !tracker.has("micAcquired")) {
          tracker.mark("micAcquired", result.micAcquiredAt);
        }

        // In streaming mode, micOpen was already marked by the onMicReady
        // callback (fires at pipeline-connect, before WS). For non-streaming,
        // mark it now — the MediaRecorder is already capturing.
        if (!tracker.has("micOpen")) {
          tracker.mark("micOpen", result.micOpenAt);
        }

        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.pauseMediaPlayback?.();
        }

        // Start cue may have already been played by onMicReady (streaming).
        // Guard against double-play via the micOpen mark — if onMicReady
        // already fired, micOpen is set and the cue was already played.
        if (!result.micOpenAt) {
          void playStartCue();
        }
      } else {
        // Recording never actually started — discard the half-formed tracker.
        latencyTrackerRef.current = null;
      }

      return didStart;
    } finally {
      startLockRef.current = false;
      setIsStarting(false);
    }
  }, []);

  const performStopRecording = useCallback(async () => {
    if (stopLockRef.current) return false;
    stopLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isStreamingStartInProgress) return false;

      // WhisperWoof latency: micStop + sttStart happen at the boundary
      // between "user is speaking" and "processing has begun". In
      // non-streaming mode the audio manager queues processAudio
      // immediately; in streaming mode the final chunk flush starts.
      latencyTrackerRef.current?.mark("micStop");
      latencyTrackerRef.current?.mark("sttStart");

      if (currentState.isStreaming || currentState.isStreamingStartInProgress) {
        void playStopCue();
        return await audioManagerRef.current.stopStreamingRecording();
      }

      const didStop = audioManagerRef.current.stopRecording();

      if (didStop) {
        void playStopCue();
      }

      return didStop;
    } finally {
      stopLockRef.current = false;
    }
  }, []);

  useEffect(() => {
    audioManagerRef.current = new AudioManager();

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing, isStreaming }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
        setIsStreaming(isStreaming ?? false);
        // Processing starts with STT; audioManager emits onProcessingPhase('polishing')
        // when the reasoning step begins. Reset to idle when processing ends.
        setProcessingPhase(isProcessing ? "transcribing" : "idle");
        if (!isRecording) setIsSpeaking(false);
        if (!isStreaming) {
          setPartialTranscript("");
        }
        if (isRecording) {
          clearTimeout(liveDoneTimerRef.current);
          clearTimeout(heardNothingTimerRef.current);
          setHeardNothing(false);
          setLiveFinalText("");
          setLiveSegments(EMPTY_LIVE_SEGMENTS);
          const live = !!audioManagerRef.current?.getLiveDictationPlan?.().live;
          isLiveModeRef.current = live;
          setIsLiveMode(live);
        } else if (!isProcessing) {
          // Live mode keeps the draft on screen through the final pass; it's
          // only dropped once processing ends (the pasted text takes over).
          setLiveSegments(EMPTY_LIVE_SEGMENTS);
        }
      },
      onRmsUpdate: (rms) => {
        // Voice-activity detection with hysteresis. The old flat 0.005 threshold
        // sat below many mics' ambient noise floor, so the indicator "waved"
        // constantly even in silence. Require a clear voice level to start
        // (0.02) and hold until it drops below 0.012 to stop — ambient noise
        // can't reach 0.02, and real speech stays above 0.012.
        setIsSpeaking((prev) => (prev ? rms > 0.012 : rms > 0.02));
      },
      onError: (error) => {
        notify({
          sign: "Error",
          tone: "error",
          title: getRecordingErrorTitle(error, t),
          description: error.description,
        });
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
      },
      // WhisperWoof: streaming mic-ready callback. Fires when the audio
      // pipeline is connected (after getUserMedia + AudioWorklet) but BEFORE
      // the WebSocket connects. This lets us mark micOpen + play the start
      // cue 50-200ms earlier than waiting for the full startStreamingRecording.
      onMicReady: ({ micAcquiredAt, micOpenAt }) => {
        const tracker = latencyTrackerRef.current;
        if (tracker) {
          if (micAcquiredAt != null) tracker.mark("micAcquired", micAcquiredAt);
          tracker.mark("micOpen", micOpenAt);
        }
        void playStartCue();
      },
      // Stream couldn't start or died (preview model missing, server error):
      // keep the panel, but say why no words appear instead of "Start talking…".
      onLiveStreamUnavailable: (notice) => setLiveNotice(notice ?? "unavailable"),
      onPartialTranscript: (payload) => {
        const segments = toLiveSegments(payload);
        setLiveSegments(segments);
        setPartialTranscript(segments.text);
      },
      onProcessingPhase: (phase) => {
        setProcessingPhase(phase);
      },
      onTranscriptionComplete: async (result) => {
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }

        if (result.success) {
          const transcribedText = result.text?.trim();

          if (!transcribedText) {
            if (result.noSpeech) {
              clearTimeout(heardNothingTimerRef.current);
              setHeardNothing(true);
              heardNothingTimerRef.current = setTimeout(
                () => setHeardNothing(false),
                HEARD_NOTHING_HOLD_MS
              );
            }
            return;
          }

          clearTimeout(liveDoneTimerRef.current);
          setLiveFinalText(transcribedText);
          liveDoneTimerRef.current = setTimeout(() => setLiveFinalText(""), LIVE_DONE_HOLD_MS);

          // WhisperWoof latency: the STT stage just completed — mark it.
          // The tracker was started in performStartRecording (hotkey) and
          // advanced through micOpen/micStop/sttStart in start/stop.
          const tracker = latencyTrackerRef.current;
          tracker?.mark("sttEnd");
          const pipelineStart = performance.now();
          const timings = {};


          // Polish already happened upstream in audioManager.processTranscription
          // (gated by Intelligence > "Enable text cleanup"). result.text is
          // polished output, result.rawText is the unpolished transcript.
          // See audioManager.js:648 for the canonical polish call.
          const textToPaste = result.text;
          const rawText = result.rawText ?? result.text;
          timings.polishMs = result.timings?.reasoningProcessingDurationMs ?? 0;

          // WhisperWoof: Log full pipeline timing
          timings.totalMs = Math.round(performance.now() - pipelineStart);
          logger.info("WhisperWoof pipeline timing", timings, "whisperwoof");

          // Show timing in debug mode
          if (localStorage.getItem("whisperwoof-debug") === "true") {
            notify({
              sign: "Debug",
              title: `Pipeline: ${timings.totalMs}ms`,
              description: `Polish: ${timings.polishMs ?? "?"}ms`,
              durationMs: NOTICE_MS.brief,
            });
          }

          setTranscript(textToPaste);
          // Counts successful dictations so the indicator can celebrate only when
          // text actually landed (not on cancel, error, or silence).
          setCompletedCount((count) => count + 1);

          // Once, after the first dictation Whisper heard as Chinese, Japanese
          // or Korean: Auto mode hears one language per recording, so a long
          // switch into English can come out translated (auto-language-note.ts).
          let tipShown = true;
          try {
            tipShown = localStorage.getItem(MIXED_LANGUAGE_TIP_KEY) === "1";
          } catch {
            // No storage: skip the tip rather than repeat it on every dictation.
          }
          if (
            shouldShowMixedLanguageTip({
              detectedLanguage: result.detectedLanguage,
              alreadyShown: tipShown,
            })
          ) {
            try {
              localStorage.setItem(MIXED_LANGUAGE_TIP_KEY, "1");
              notify({
                sign: "Tip",
                title: t("app.toasts.mixedLanguageTip.title"),
                description: t("app.toasts.mixedLanguageTip.description"),
              });
            } catch {
              // Couldn't remember it was shown; better no tip than one every time.
            }
          }

          // WhisperWoof: Route based on active hotkey combo
          const hotkeyUsed = activeHotkeyRef.current ?? "Fn";
          const routedTo = routeForHotkey(hotkeyUsed);
          // The live panel already says "Copied" / "Saved as note".
          const showRouteNotice = !isLiveModeRef.current;
          // The note fn+N / fn+P just wrote; linked to this dictation's entry
          // once that's saved below, so the Notes view can play the recording.
          let savedNoteName = null;
          const openNoteAction = (name) => ({
            label: "Open",
            onClick: () => window.electronAPI?.whisperwoofOpenVoiceNote?.(name ?? null),
          });

          const isStreaming = result.source?.includes("streaming");
          const { autoPasteEnabled, keepTranscriptionInClipboard } = getSettings();

          tracker?.mark("pasteStart");
          if (routedTo === "copy-to-clipboard") {
            // Fn+T: Copy to clipboard only (don't paste at cursor)
            await copyTextFromOverlay(textToPaste, window.electronAPI, (text) =>
              navigator.clipboard.writeText(text)
            );
            logger.info("WhisperWoof routed to clipboard", { hotkeyUsed, textLength: textToPaste.length }, "whisperwoof");
            if (showRouteNotice) {
              notify({
                sign: "Copied",
                tone: "success",
                title: t("hooks.audioRecording.copied", "Copied to clipboard"),
                description: noticeExcerpt(textToPaste),
                durationMs: NOTICE_MS.brief,
              });
            }
          } else if (routedTo === "save-as-markdown") {
            // Fn+N: Save as Markdown file
            const saveResult = await window.electronAPI?.whisperwoofSaveMarkdown?.(textToPaste);
            if (saveResult?.success) {
              savedNoteName = saveResult.name ?? null;
              logger.info("WhisperWoof routed to markdown", { hotkeyUsed, filePath: saveResult.filePath }, "whisperwoof");
              if (showRouteNotice) {
                notify({
                  sign: "Saved",
                  tone: "success",
                  title: "Saved as note",
                  description: noticeExcerpt(textToPaste),
                  durationMs: NOTICE_MS.withDetail,
                  actions: [openNoteAction(saveResult.name)],
                });
              }
            } else {
              logger.error(`WhisperWoof markdown save failed: ${saveResult?.error || "unknown"}`);
              notify({ sign: "Error", tone: "error", title: "Failed to save note", description: saveResult?.error });
            }
          } else if (routedTo === "project") {
            // Fn+P: save as a note in the default project (Inbox until the
            // user picks another in Projects).
            const saveResult = await window.electronAPI?.whisperwoofSaveProjectNote?.(textToPaste);
            if (saveResult?.success) {
              savedNoteName = saveResult.name ?? null;
              logger.info("WhisperWoof routed to project", { hotkeyUsed, project: saveResult.project?.name }, "whisperwoof");
              if (showRouteNotice) {
                notify({
                  sign: "Filed",
                  tone: "success",
                  title: `Saved to ${saveResult.project?.name ?? "project"}`,
                  description: noticeExcerpt(textToPaste),
                  durationMs: NOTICE_MS.withDetail,
                  actions: [openNoteAction(saveResult.name)],
                });
              }
            } else {
              logger.error(`WhisperWoof project note save failed: ${saveResult?.error || "unknown"}`);
              notify({ sign: "Error", tone: "error", title: "Couldn't save to project", description: saveResult?.error });
            }
          } else if (autoPasteEnabled) {
            const pasteStart = performance.now();
            await audioManagerRef.current.safePaste(textToPaste, {
              ...(isStreaming ? { fromStreaming: true } : {}),
              restoreClipboard: !keepTranscriptionInClipboard,
            });
            logger.info(
              "Paste timing",
              {
                pasteMs: Math.round(performance.now() - pasteStart),
                source: result.source,
                textLength: result.text.length,
              },
              "streaming"
            );
          } else {
            if (keepTranscriptionInClipboard) {
              await copyTextFromOverlay(textToPaste, window.electronAPI, (text) =>
                navigator.clipboard.writeText(text)
              );
            }
            logger.info(
              "WhisperWoof auto-paste disabled — skipped paste-at-cursor",
              { hotkeyUsed, textLength: textToPaste.length, copiedToClipboard: keepTranscriptionInClipboard },
              "whisperwoof"
            );
            notify({
              sign: "Done",
              title: t("hooks.audioRecording.autoPasteDisabled", "Transcribed (auto-paste off)"),
              description: noticeExcerpt(textToPaste),
              durationMs: NOTICE_MS.brief,
            });
          }
          tracker?.mark("pasteEnd");

          // Awaited (after the paste, so nothing the user sees waits on it):
          // the upstream row's id is the only link from this entry to the
          // audio file it was transcribed from, which History → Regenerate
          // needs. Retention off / failure → no id, and the entry still saves.
          const saved = await audioManagerRef.current.saveTranscription(textToPaste, rawText);

          // WhisperWoof: Build latency timings + persist to bf_entries
          const capturedTimings = tracker?.toTimings() ?? null;
          const speakingDurationMs = capturedTimings?.speakingMs ?? null;

          if (capturedTimings) {
            const budget = PERCEIVED_LATENCY_BUDGET_MS;
            const pMs = capturedTimings.perceivedMs;
            const label = pMs != null && pMs <= budget ? "PASS" : "OVER";
            logger.info(
              `WhisperWoof latency [${label}]`,
              {
                perceivedMs: pMs,
                budget,
                startupMs: capturedTimings.startupMs,
                micAcquireMs: capturedTimings.micAcquireMs,
                speakingMs: capturedTimings.speakingMs,
                sttMs: capturedTimings.sttMs,
                polishMs: capturedTimings.polishMs,
                pasteMs: capturedTimings.pasteMs,
                totalMs: capturedTimings.totalMs,
              },
              "whisperwoof"
            );
          }

          // Reset tracker for next capture
          latencyTrackerRef.current = null;

          const entrySaved = window.electronAPI?.whisperwoofSaveEntry?.({
            source: 'voice',
            rawText: rawText,
            polished: textToPaste !== rawText ? textToPaste : null,
            routedTo,
            hotkeyUsed,
            durationMs: speakingDurationMs,
            projectId: null,
            audioPath: null,
            metadata: {
              ...(capturedTimings ? { timings: capturedTimings } : {}),
              ...(saved?.id ? { transcriptionId: saved.id } : {}),
              // What produced this text, so History can show it and offer a
              // different model for regeneration.
              stt: {
                source: result.source ?? null,
                model: result.model ?? result.sttModel ?? null,
              },
            },
          });
          if (savedNoteName) {
            const noteName = savedNoteName;
            Promise.resolve(entrySaved).then((saved) => {
              if (saved?.success && saved.id) {
                window.electronAPI?.whisperwoofNotesLinkEntry?.(noteName, saved.id);
              }
            });
          }

          if (result.source === "openai" && getSettings().useLocalWhisper) {
            notify({
              sign: "Cloud",
              title: t("hooks.audioRecording.fallback.title"),
              description: t("hooks.audioRecording.fallback.description"),
            });
          }

          // Cloud usage: limit reached after this transcription
          if (result.source === "openwhispr" && result.limitReached) {
            // Notify control panel to show UpgradePrompt dialog
            window.electronAPI?.notifyLimitReached?.({
              wordsUsed: result.wordsUsed,
              limit:
                result.wordsRemaining !== undefined
                  ? result.wordsUsed + result.wordsRemaining
                  : 2000,
            });
          }

          if (audioManagerRef.current.shouldUseStreaming()) {
            audioManagerRef.current.warmupStreamingConnection();
          }
        }
      },
    });

    audioManagerRef.current.setContext("dictation");
    window.electronAPI.getSttConfig?.().then((config) => {
      if (config?.success && audioManagerRef.current) {
        audioManagerRef.current.setSttConfig(config);
        if (audioManagerRef.current.shouldUseStreaming()) {
          audioManagerRef.current.warmupStreamingConnection();
        }
      }
    });

    const handleToggle = async () => {
      if (!audioManagerRef.current) return;
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording && !currentState.isProcessing) {
        await performStartRecording();
      } else if (currentState.isRecording) {
        await performStopRecording();
      }
    };

    const handleStart = async () => {
      await performStartRecording();
    };

    const handleStop = async () => {
      await performStopRecording();
    };

    const disposeToggle = window.electronAPI.onToggleDictation(() => {
      handleToggle();
      onToggle?.();
    });

    const disposeStart = window.electronAPI.onStartDictation?.(() => {
      activeHotkeyRef.current = null;
      handleStart();
      onToggle?.();
    });

    const disposeRoute = window.electronAPI.onDictationRoute?.((hotkeyUsed) => {
      setDictationRoute(routeForHotkey(hotkeyUsed));
    });

    const disposeStop = window.electronAPI.onStopDictation?.((hotkeyUsed) => {
      activeHotkeyRef.current = hotkeyUsed ?? null;
      setDictationRoute(routeForHotkey(hotkeyUsed));
      handleStop();
      onToggle?.();
    });

    // A stray single Fn tap: the main-process activation machine decided
    // nothing meaningful was said — discard the capture, paste nothing.
    // Same teardown as the hook's cancelRecording(): a cloud streaming
    // session has no MediaRecorder to cancel, and paused media must resume.
    const disposeCancel = window.electronAPI.onCancelDictation?.(() => {
      activeHotkeyRef.current = null;
      const manager = audioManagerRef.current;
      if (manager) {
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
        if (manager.getState().isStreaming) {
          manager.stopStreamingRecording();
        } else {
          manager.cancelRecording();
        }
      }
      onToggle?.();
    });

    const handleNoAudioDetected = () => {
      // Mando says it himself in the live panel and the full indicator; only
      // the minimal indicators (dot, compact) still need a notice.
      const mandoShows =
        isLiveModeRef.current || (localStorage.getItem("indicatorStyle") || "full") === "full";
      if (mandoShows) return;
      notify({
        sign: "No voice",
        puzzled: true,
        title: t("hooks.audioRecording.noAudio.title"),
        description: t("hooks.audioRecording.noAudio.description"),
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    // Cleanup
    return () => {
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      disposeRoute?.();
      disposeCancel?.();
      disposeNoAudio?.();
      clearTimeout(liveDoneTimerRef.current);
      clearTimeout(heardNothingTimerRef.current);
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [notify, onToggle, performStartRecording, performStopRecording, t]);

  const cancelRecording = async () => {
    if (audioManagerRef.current) {
      const state = audioManagerRef.current.getState();
      if (getSettings().pauseMediaOnDictation) {
        window.electronAPI?.resumeMediaPlayback?.();
      }
      if (state.isStreaming) {
        return await audioManagerRef.current.stopStreamingRecording();
      }
      return audioManagerRef.current.cancelRecording();
    }
    return false;
  };

  const cancelProcessing = () => {
    if (audioManagerRef.current) {
      return audioManagerRef.current.cancelProcessing();
    }
    return false;
  };

  const toggleListening = async () => {
    if (!isRecording && !isProcessing) {
      await performStartRecording();
    } else if (isRecording) {
      await performStopRecording();
    }
  };

  return {
    isRecording,
    isProcessing,
    completedCount,
    processingPhase,
    isStreaming,
    isSpeaking,
    transcript,
    partialTranscript,
    liveSegments,
    isLiveMode,
    liveFinalText,
    liveNotice,
    dictationRoute,
    isStarting,
    heardNothing,
    startRecording: performStartRecording,
    stopRecording: performStopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
  };
};
