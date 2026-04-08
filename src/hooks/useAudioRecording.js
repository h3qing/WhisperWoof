import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { getSettings } from "../stores/settingsStore";
import { getRecordingErrorTitle } from "../utils/recordingErrors";

export const useAudioRecording = (toast, options = {}) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const audioManagerRef = useRef(null);
  const startLockRef = useRef(false);
  const stopLockRef = useRef(false);
  const activeHotkeyRef = useRef(null); // Hotkey combo used during this dictation (e.g. "Fn+T")
  const { onToggle } = options;

  const performStartRecording = useCallback(async () => {
    if (startLockRef.current) return false;
    startLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording || currentState.isProcessing) return false;

      // Retry STT config fetch if it wasn't loaded on mount (e.g. auth wasn't ready)
      if (!audioManagerRef.current.sttConfig) {
        const config = await window.electronAPI.getSttConfig?.();
        if (config?.success) {
          audioManagerRef.current.setSttConfig(config);
        }
      }

      const didStart = audioManagerRef.current.shouldUseStreaming()
        ? await audioManagerRef.current.startStreamingRecording()
        : await audioManagerRef.current.startRecording();

      if (didStart) {
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.pauseMediaPlayback?.();
        }
        void playStartCue();
      }

      return didStart;
    } finally {
      startLockRef.current = false;
    }
  }, []);

  const performStopRecording = useCallback(async () => {
    if (stopLockRef.current) return false;
    stopLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isStreamingStartInProgress) return false;

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
        if (!isRecording) setIsSpeaking(false);
        if (!isStreaming) {
          setPartialTranscript("");
        }
      },
      onRmsUpdate: (rms) => {
        // Voice activity threshold: RMS > 0.005 means user is speaking
        setIsSpeaking(rms > 0.005);
      },
      onError: (error) => {
        const title = getRecordingErrorTitle(error, t);
        toast({
          title,
          description: error.description,
          variant: "destructive",
          duration: error.code === "AUTH_EXPIRED" ? 8000 : undefined,
        });
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }
      },
      onPartialTranscript: (text) => {
        setPartialTranscript(text);
      },
      onTranscriptionComplete: async (result) => {
        if (getSettings().pauseMediaOnDictation) {
          window.electronAPI?.resumeMediaPlayback?.();
        }

        if (result.success) {
          const transcribedText = result.text?.trim();

          if (!transcribedText) {
            return;
          }

          // WhisperWoof: Pipeline timing for debug
          const pipelineStart = performance.now();
          const timings = {};

          // WhisperWoof: Voice snippets — check for trigger phrases first
          const snippetsEnabled = localStorage.getItem("whisperwoof-snippets") !== "false";
          if (snippetsEnabled) {
            try {
              const expansion = await window.electronAPI?.whisperwoofExpandSnippet?.(transcribedText);
              if (expansion?.matched) {
                setTranscript(expansion.body);
                await audioManagerRef.current.safePaste(expansion.body, {
                  restoreClipboard: !getSettings().keepTranscriptionInClipboard,
                });
                toast({
                  title: `\u26A1 Snippet: "${expansion.trigger}"`,
                  description: expansion.body.slice(0, 60) + (expansion.body.length > 60 ? "..." : ""),
                  variant: "default",
                  duration: 2000,
                });
                window.electronAPI?.whisperwoofSaveEntry?.({
                  source: 'voice',
                  rawText: transcribedText,
                  polished: expansion.body,
                  routedTo: `snippet:${expansion.trigger}`,
                  hotkeyUsed: null,
                  durationMs: null,
                  projectId: null,
                  audioPath: null,
                  metadata: { snippet: expansion.trigger, matchType: expansion.matchType },
                });
                return; // Skip polish + voice commands — snippet handled it
              }
            } catch (snippetError) {
              logger.warn("WhisperWoof snippet expansion failed", { error: snippetError }, "whisperwoof");
            }
          }

          // WhisperWoof: Voice editing commands — detect before polish
          // If the spoken text is a command (e.g., "rewrite this", "translate to Spanish"),
          // read the clipboard and apply the command instead of pasting new text.
          const voiceCommandsEnabled = localStorage.getItem("whisperwoof-voice-commands") !== "false";
          if (voiceCommandsEnabled) {
            try {
              const detection = await window.electronAPI?.whisperwoofDetectVoiceCommand?.(transcribedText);
              if (detection?.isCommand) {
                const clipboardText = await navigator.clipboard.readText();
                if (clipboardText?.trim()) {
                  const cmdResult = await window.electronAPI?.whisperwoofVoiceCommand?.(
                    transcribedText,
                    clipboardText,
                  );
                  if (cmdResult?.success && cmdResult.text) {
                    // Write result to clipboard and paste it
                    await navigator.clipboard.writeText(cmdResult.text);
                    setTranscript(cmdResult.text);
                    await audioManagerRef.current.safePaste(cmdResult.text, {
                      restoreClipboard: false,
                    });
                    toast({
                      title: `\u2728 ${detection.command || "Command"} applied`,
                      description: cmdResult.text.slice(0, 60) + (cmdResult.text.length > 60 ? "..." : ""),
                      variant: "default",
                      duration: 3000,
                    });
                    // Save to history
                    window.electronAPI?.whisperwoofSaveEntry?.({
                      source: 'voice',
                      rawText: transcribedText,
                      polished: cmdResult.text,
                      routedTo: `voice-command:${detection.command}`,
                      hotkeyUsed: null,
                      durationMs: null,
                      projectId: null,
                      audioPath: null,
                      metadata: { voiceCommand: detection.command, originalText: clipboardText.slice(0, 200) },
                    });
                    return; // Skip normal polish + paste flow
                  }
                }
              }
            } catch (cmdError) {
              logger.warn("WhisperWoof voice command detection failed", { error: cmdError }, "whisperwoof");
            }
          }

          // WhisperWoof: Ollama text polish (if available)
          let textToPaste = result.text;
          let rawText = result.rawText ?? result.text;

          const polishEnabled = localStorage.getItem("whisperwoof-polish-enabled") !== "false";

          if (polishEnabled) {
            try {
              const polishStart = performance.now();
              const polishPreset = localStorage.getItem("whisperwoof-polish-preset") || "clean";
              const customPrompt = localStorage.getItem("whisperwoof-custom-prompt") || "";
              const polishProvider = localStorage.getItem("whisperwoof-polish-provider") || "ollama";
              const polishModel = localStorage.getItem("whisperwoof-polish-model") || "";
              const polishApiKey = localStorage.getItem(`whisperwoof-${polishProvider}-api-key`) || "";
              const polishResult = await window.electronAPI?.whisperwoofOllamaPolish?.(
                transcribedText,
                {
                  preset: polishPreset,
                  customPrompt,
                  provider: polishProvider,
                  model: polishModel || undefined,
                  apiKey: polishApiKey || undefined,
                }
              );
              timings.polishMs = Math.round(performance.now() - polishStart);
            if (polishResult?.polished && polishResult.text) {
              rawText = transcribedText;
              textToPaste = polishResult.text;
              logger.info(
                "WhisperWoof Ollama polish applied",
                {
                  inputLen: transcribedText.length,
                  outputLen: polishResult.text.length,
                  elapsed: polishResult.elapsed,
                },
                "whisperwoof"
              );

              // WhisperWoof: Learning mode — show polish before/after
              const captureCount = parseInt(localStorage.getItem("whisperwoof_capture_count") || "0", 10);
              const isLearningMode = captureCount < 20;
              localStorage.setItem("whisperwoof_capture_count", String(captureCount + 1));

              if (isLearningMode && polishResult.polished) {
                toast({
                  title: "\u2728 Text polished",
                  description: `"${polishResult.text.slice(0, 60)}${polishResult.text.length > 60 ? '...' : ''}"`,
                  variant: "default",
                  duration: 5000,
                });
              }
            }
            } catch (polishError) {
              timings.polishMs = Math.round(performance.now() - (pipelineStart + (timings.polishMs || 0)));
              logger.warn("WhisperWoof Ollama polish failed", { error: polishError }, "whisperwoof");
            }
          } else {
            timings.polishMs = 0; // skipped
          }

          // WhisperWoof: Log full pipeline timing
          timings.totalMs = Math.round(performance.now() - pipelineStart);
          logger.info("WhisperWoof pipeline timing", timings, "whisperwoof");

          // Show timing in debug mode
          if (localStorage.getItem("whisperwoof-debug") === "true") {
            toast({
              title: `Pipeline: ${timings.totalMs}ms`,
              description: `Polish: ${timings.polishMs ?? "?"}ms`,
              variant: "default",
              duration: 3000,
            });
          }

          setTranscript(textToPaste);

          // WhisperWoof: Route based on active hotkey combo
          const hotkeyUsed = activeHotkeyRef.current ?? "Fn";
          const routeMap = {
            "Fn":    "paste-at-cursor",
            "Fn+T":  "copy-to-clipboard",
            "Fn+N":  "save-as-markdown",
            "Fn+P":  "project",
          };
          const routedTo = routeMap[hotkeyUsed] ?? "paste-at-cursor";

          const isStreaming = result.source?.includes("streaming");
          const { keepTranscriptionInClipboard } = getSettings();

          if (routedTo === "copy-to-clipboard") {
            // Fn+T: Copy to clipboard only (don't paste at cursor)
            await navigator.clipboard.writeText(textToPaste);
            logger.info("WhisperWoof routed to clipboard", { hotkeyUsed, textLength: textToPaste.length }, "whisperwoof");
            toast({
              title: t("hooks.audioRecording.copied", "Copied to clipboard"),
              description: textToPaste.length > 80 ? textToPaste.slice(0, 80) + "…" : textToPaste,
              variant: "default",
              duration: 3000,
            });
          } else {
            // Default: paste at cursor
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
          }

          audioManagerRef.current.saveTranscription(textToPaste, rawText);

          // WhisperWoof: Save to bf_entries for unified history
          window.electronAPI?.whisperwoofSaveEntry?.({
            source: 'voice',
            rawText: rawText,
            polished: textToPaste !== rawText ? textToPaste : null,
            routedTo,
            hotkeyUsed,
            durationMs: null, // TODO: get from audio recording
            projectId: null,
            audioPath: null,
            metadata: {},
          });

          if (result.source === "openai" && getSettings().useLocalWhisper) {
            toast({
              title: t("hooks.audioRecording.fallback.title"),
              description: t("hooks.audioRecording.fallback.description"),
              variant: "default",
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

    const disposeStop = window.electronAPI.onStopDictation?.((hotkeyUsed) => {
      activeHotkeyRef.current = hotkeyUsed ?? null;
      handleStop();
      onToggle?.();
    });

    const handleNoAudioDetected = () => {
      toast({
        title: t("hooks.audioRecording.noAudio.title"),
        description: t("hooks.audioRecording.noAudio.description"),
        variant: "default",
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    // Cleanup
    return () => {
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      disposeNoAudio?.();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [toast, onToggle, performStartRecording, performStopRecording, t]);

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
    isStreaming,
    isSpeaking,
    transcript,
    partialTranscript,
    startRecording: performStartRecording,
    stopRecording: performStopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
  };
};
