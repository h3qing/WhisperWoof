import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { CancelRecordingButton } from "./whisperwoof/ui/indicator/CancelRecordingButton";
import { useToast } from "./components/ui/Toast";
import { LoadingDots } from "./components/ui/LoadingDots";
import { useHotkey } from "./hooks/useHotkey";
import { formatHotkeyLabel } from "./utils/hotkeys";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { getPlatform } from "./utils/platform";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useSettingsStore } from "./stores/settingsStore";
import { MandoSprite } from "./whisperwoof/ui/indicator/MandoSprite";
import { LiveDictationPanel } from "./whisperwoof/ui/indicator/LiveDictationPanel";
import { RouteChip } from "./whisperwoof/ui/indicator/RouteChip";
import { deriveLivePanelView, pickLivePanelFrame } from "./whisperwoof/core/live/live-dictation";
import {
  pickMandoAction,
  nextCelebration,
  MANDO_CELEBRATION_MS,
} from "./whisperwoof/ui/indicator/mando-sprite";

// WhisperWoof Indicator — animated Mando + waveform + status
// Mando on top (head-tilt while waiting for voice, nodding while you speak,
// thinking while processing, a hop once the text lands), status text,
// animated waveform bars, and transcribed text preview

// Dog-themed processing verbs — a random one shows each time
const PROCESSING_VERBS = [
  "Fetching your words...",
  "Sniffing out the meaning...",
  "Polishing your thoughts...",
  "Chewing on that...",
  "Shaking off the filler...",
  "Grooming your text...",
  "Digging up the good parts...",
  "Herding your words...",
  "Nuzzling the grammar...",
  "Pawing through the transcript...",
  "Tail-wagging over this one...",
  "Rolling in your ideas...",
  "Perking up the punctuation...",
];

function pickProcessingVerb() {
  return PROCESSING_VERBS[Math.floor(Math.random() * PROCESSING_VERBS.length)];
}

const WhisperWoofIndicator = ({ state = 'idle', size = 48, animated = false, speaking = false, recording = false, celebrating = false, onCelebrationEnd, lastText = '', mode = 'full', partialTranscript = '', processingPhase = 'transcribing', route = 'paste-at-cursor' }) => {
  const isSpeaking = speaking;
  const isRecordingSilent = recording && !speaking;
  const isProcessing = state === 'processing';
  const isIdle = !recording && !isProcessing;
  const mando = pickMandoAction({ speaking: isSpeaking, recordingSilent: isRecordingSilent, processing: isProcessing, celebrating });
  const showLiveTranscript = localStorage.getItem("whisperwoof-live-transcript") !== "false";

  // Keep the dog-pun flavor for the transcription phase, switch to a clear
  // "Polishing…" once the reasoning step starts, and after ~8s surface a
  // "still working" hint so a slow/cold run is distinguishable from a hang.
  const [processingSlow, setProcessingSlow] = useState(false);
  const processingVerbRef = useRef(pickProcessingVerb());
  useEffect(() => {
    if (!isProcessing) {
      setProcessingSlow(false);
      return;
    }
    processingVerbRef.current = pickProcessingVerb();
    const id = setTimeout(() => setProcessingSlow(true), 8000);
    return () => clearTimeout(id);
  }, [isProcessing]);

  const processingLabel = processingSlow
    ? 'Still working…'
    : processingPhase === 'polishing'
      ? 'Polishing…'
      : processingVerbRef.current;

  // Waveform bars — 20 bars with bell-curve heights
  const barCount = 20;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const center = barCount / 2;
    const dist = Math.abs(i - center) / center;
    return Math.round(6 + (1 - dist) * 18);
  });

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
      minWidth: '180px',
    }}>
      <style>{`
        @keyframes mandoBreath { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes waveBar { 0%, 100% { height: var(--idle-h); opacity: 0.3; } 50% { height: var(--peak-h); opacity: 0.8; } }
        @keyframes procBar { 0%, 100% { height: var(--idle-h); opacity: 0.2; } 50% { height: var(--proc-h); opacity: 0.5; } }
        @keyframes dotPulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.3); opacity: 1; } }
      `}</style>

      {/* Dot mode: just a colored circle */}
      {mode === 'dot' && (
        <div style={{
          width: '12px', height: '12px', borderRadius: '50%',
          background: isSpeaking ? '#A06A3C' : isRecordingSilent ? '#736858' : isProcessing ? '#A06A3C' : '#3E3830',
          animation: (isSpeaking || isProcessing) ? 'dotPulse 1s ease-in-out infinite' : 'none',
          boxShadow: isSpeaking ? '0 0 8px rgba(160,106,60,0.5)' : 'none',
        }} />
      )}

      {/* Compact mode: just waveform bars, no head, no text */}
      {mode === 'compact' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '20px' }}>
          {bars.slice(0, 12).map((peakH, i) => {
            const idleH = 3;
            return (
              <div key={i} style={{
                width: '2.5px', borderRadius: '2px',
                background: isSpeaking ? '#A06A3C' : isProcessing ? '#736858' : 'rgba(232,213,195,0.12)',
                '--idle-h': `${idleH}px`, '--peak-h': `${peakH * 0.7}px`, '--proc-h': `${peakH * 0.4}px`,
                height: (isIdle || isRecordingSilent) ? `${idleH}px` : undefined,
                animation: isSpeaking ? `waveBar 0.8s ease-in-out ${i * 0.06}s infinite` : isProcessing ? `procBar 1.5s ease-in-out ${i * 0.1}s infinite` : 'none',
              }} />
            );
          })}
        </div>
      )}

      {/* Full mode: animated Mando */}
      {mode === 'full' && (<>

      <MandoSprite
        action={mando.action}
        playing={mando.playing}
        loop={mando.loop}
        onAnimationEnd={mando.action === 'hop' ? onCelebrationEnd : undefined}
        size={64}
        style={{
          filter: `drop-shadow(0 2px 8px rgba(0,0,0,0.3))`,
          opacity: isIdle && !celebrating ? 0.6 : isSpeaking ? 0.95 : 0.85,
          transition: 'opacity 0.3s',
        }}
      />

      {/* Status text */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '9px',
        fontWeight: 500,
        letterSpacing: '0.3px',
        whiteSpace: 'nowrap',
      }}>
        {(recording || isProcessing) && <RouteChip route={route} size="sm" />}
        {isSpeaking ? (
          showLiveTranscript && partialTranscript ? (
            <div aria-hidden="true" style={{
              maxWidth: '180px',
              overflow: 'hidden',
              display: 'flex',
              justifyContent: 'flex-end',
              maskImage: 'linear-gradient(to right, transparent 0%, black 20%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 20%)',
            }}>
              <span style={{
                color: '#E8A060',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {partialTranscript}
              </span>
            </div>
          ) : (
            <span style={{ color: '#E8A060', fontWeight: 600 }}>Listening...</span>
          )
        ) : isRecordingSilent ? (
          <span style={{ color: 'rgba(232,213,195,0.5)' }}>Waiting for voice...</span>
        ) : isProcessing ? (
          <span style={{ color: '#A06A3C', animation: 'mandoBreath 1.5s ease-in-out infinite' }}>{processingLabel}</span>
        ) : (
          <span style={{ color: 'rgba(232,213,195,0.35)' }}>Hold Fn to record</span>
        )}
      </div>

      {/* Waveform bars */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        height: '24px',
      }}>
        {bars.map((peakH, i) => {
          const idleH = 3;
          const procH = Math.round(peakH * 0.5);
          return (
            <div
              key={i}
              style={{
                width: '3px',
                borderRadius: '3px',
                background: isSpeaking
                  ? (i % 3 === 0 ? '#E8A060' : '#C87B3A')
                  : isProcessing
                    ? '#A06A3C'
                    : isRecordingSilent
                      ? 'rgba(232,213,195,0.2)'
                      : 'rgba(232,213,195,0.12)',
                '--idle-h': `${idleH}px`,
                '--peak-h': `${peakH}px`,
                '--proc-h': `${procH}px`,
                height: (isIdle || isRecordingSilent) ? `${idleH}px` : undefined,
                animation: isSpeaking
                  ? `waveBar 0.8s ease-in-out ${i * 0.06}s infinite`
                  : isProcessing
                    ? `procBar 1.5s ease-in-out ${i * 0.1}s infinite`
                    : 'none',
                transition: 'background 0.3s',
              }}
            />
          );
        })}
      </div>

      {/* Last transcribed text preview */}
      {lastText && !isIdle && (
        <div style={{
          fontSize: '9px',
          color: 'rgba(232,213,195,0.5)',
          maxWidth: '200px',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontStyle: 'italic',
        }}>
          "{lastText}"
        </div>
      )}
      </>)}
    </div>
  );
};

// Tooltip Component
const Tooltip = ({ children, content, emoji, align = "center" }) => {
  const [isVisible, setIsVisible] = useState(false);

  const alignClass =
    align === "right" ? "right-0" : align === "left" ? "left-0" : "left-1/2 -translate-x-1/2";

  const arrowClass =
    align === "right" ? "right-3" : align === "left" ? "left-3" : "left-1/2 -translate-x-1/2";

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
        {children}
      </div>
      {isVisible && content && (
        <div
          className={`absolute bottom-full ${alignClass} mb-2 px-1.5 py-1 text-[10px] text-popover-foreground bg-popover border border-border rounded-md z-10 shadow-lg transition-opacity duration-150 whitespace-nowrap`}
        >
          {emoji && <span className="mr-1">{emoji}</span>}
          {content}
          <div
            className={`absolute top-full ${arrowClass} w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-popover`}
          ></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const { toast, dismiss, toastCount } = useToast();
  const { t } = useTranslation();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();

  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);

  // Floating icon auto-hide setting (read from store, synced via IPC)
  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);
  const panelStartPosition = useSettingsStore((s) => s.panelStartPosition);
  const liveModeEnabled = useSettingsStore((s) => s.dictationMode === "live" && s.useLocalWhisper);
  const prevAutoHideRef = useRef(floatingIconAutoHide);

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const unsubscribeAccessibility = window.electronAPI?.onAccessibilityMissing?.(() => {
      toast({
        title: t("app.toasts.accessibilityMissing.title"),
        description: t("app.toasts.accessibilityMissing.description"),
        duration: 12000,
      });
    });

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (words && words.length > 0) {
        const wordList = words.map((w) => `\u201c${w}\u201d`).join(", ");
        let toastId;
        toastId = toast({
          title: t("app.toasts.addedToDict", { words: wordList }),
          variant: "success",
          duration: 6000,
          action: (
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.undoLearnedCorrections?.(words);
                  if (result?.success) {
                    dismiss(toastId);
                  }
                } catch {
                  // silently fail — word stays in dictionary
                }
              }}
              className="text-[10px] font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-success hover:text-foreground
                bg-success/15 hover:bg-success/25
                border border-success/25 hover:border-success/40
                transition-all duration-150"
            >
              {t("app.toasts.undo")}
            </button>
          ),
        });
      }
    });

    // Memory asks before it ever swaps a word by itself.
    const unsubscribeSwapOffer = window.electronAPI?.onMemorySwapOffer?.((offer) => {
      if (!offer?.from || !offer?.to) return;
      let toastId;
      const answer = async (approve) => {
        try {
          await (approve
            ? window.electronAPI?.confirmMemorySwap?.(offer.from, offer.to)
            : window.electronAPI?.declineMemorySwap?.(offer.from, offer.to));
        } catch {
          // No answer recorded; Memory asks again the next time you make this fix.
        }
        dismiss(toastId);
      };
      toastId = toast({
        title: t("app.toasts.swapOffer", { from: `\u201c${offer.from}\u201d`, to: `\u201c${offer.to}\u201d` }),
        duration: 12000,
        action: (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => answer(false)}
              className="text-[10px] font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-muted-foreground hover:text-foreground
                bg-foreground/5 hover:bg-foreground/10
                border border-border hover:border-border-hover
                transition-all duration-150"
            >
              {t("app.toasts.swapNotNow")}
            </button>
            <button
              onClick={() => answer(true)}
              className="text-[10px] font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-primary-foreground bg-primary hover:bg-primary/90
                border border-primary/40
                transition-all duration-150"
            >
              {t("app.toasts.swapAlways")}
            </button>
          </div>
        ),
      });
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeAccessibility?.();
      unsubscribeCorrections?.();
      unsubscribeSwapOffer?.();
    };
  }, [toast, dismiss, t]);

  useEffect(() => {
    if (isCommandMenuOpen || toastCount > 0) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, toastCount, setWindowInteractivity]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const { isRecording, isProcessing, completedCount, processingPhase, isSpeaking, partialTranscript, liveSegments, isLiveMode, liveFinalText, liveNotice, dictationRoute, isStarting, toggleListening, cancelRecording, cancelProcessing } =
    useAudioRecording(toast, {
      onToggle: handleDictationToggle,
    });
  const indicatorMode = localStorage.getItem("indicatorStyle") || "full";
  const livePanelView = deriveLivePanelView({
    isRecording,
    isProcessing,
    processingPhase,
    segments: liveSegments,
    finalText: liveFinalText,
  });
  // A live capture is actually running (recording, final pass, or Pasted hold).
  const liveBusy = isLiveMode && livePanelView.phase !== "hidden";
  const [windowHidden, setWindowHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onVisibility = () => setWindowHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  // Remember the last frame a live capture drew (React's "store info from
  // previous renders" pattern; the key comparison stops it from looping).
  const [lastLiveFrame, setLastLiveFrame] = useState(null);
  const liveFrameKey = `${livePanelView.phase}|${livePanelView.committed}|${livePanelView.partial}`;
  const lastLiveFrameKey = lastLiveFrame
    ? `${lastLiveFrame.phase}|${lastLiveFrame.committed}|${lastLiveFrame.partial}`
    : null;
  if (liveBusy && liveFrameKey !== lastLiveFrameKey) setLastLiveFrame(livePanelView);
  const liveFrame = pickLivePanelFrame({
    view: livePanelView,
    lastFrame: lastLiveFrame,
    isLiveCapture: isLiveMode,
    starting: isStarting,
    captureRunning: isRecording || isProcessing,
    liveMode: liveModeEnabled,
    autoHide: floatingIconAutoHide,
    windowHidden,
  });
  const showLivePanel = liveFrame !== null;
  // On macOS the window becomes exactly the panel and carries native vibrancy
  // (LIVE_PANEL). A toast or menu needs transparent room around the panel, so
  // then the panel falls back to CSS glass.
  const nativeLivePanel =
    showLivePanel && getPlatform() === "darwin" && toastCount === 0 && !isCommandMenuOpen;
  // Live mode, but this capture found no usable stream (e.g. a pinned language
  // the preview model can't serve): the regular indicator needs its own height.
  const nonLiveCapture = liveModeEnabled && !showLivePanel && (isRecording || isProcessing);

  useEffect(() => {
    const resizeWindow = () => {
      if (isCommandMenuOpen && toastCount > 0) {
        window.electronAPI?.resizeMainWindow?.("EXPANDED");
      } else if (isCommandMenuOpen) {
        window.electronAPI?.resizeMainWindow?.("WITH_MENU");
      } else if (toastCount > 0) {
        window.electronAPI?.resizeMainWindow?.("WITH_TOAST");
      } else if (showLivePanel) {
        window.electronAPI?.resizeMainWindow?.("LIVE_PANEL");
      } else if (liveModeEnabled && !nonLiveCapture) {
        // Live mode keeps the wide size even when idle: resizing at every
        // capture start/end drew the panel into the narrow window first (center
        // strip, then the sides) and left a stale frame behind on shrink.
        window.electronAPI?.resizeMainWindow?.("LIVE");
      } else {
        window.electronAPI?.resizeMainWindow?.("BASE");
      }
    };
    resizeWindow();
  }, [isCommandMenuOpen, toastCount, showLivePanel, liveModeEnabled, nonLiveCapture]);

  // Sync auto-hide from main process — setState directly to avoid IPC echo
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onFloatingIconAutoHideChanged?.((enabled) => {
      localStorage.setItem("floatingIconAutoHide", String(enabled));
      useSettingsStore.setState({ floatingIconAutoHide: enabled });
    });
    return () => unsubscribe?.();
  }, []);

  // Let Mando hop once when a dictation actually lands (completedCount bumps);
  // auto-hide waits for the hop. A new recording or processing run cancels a
  // pending hop (see nextCelebration). The hop's animationend ends the
  // celebration; the timer is only a fallback in case the event never fires.
  const [celebrating, setCelebrating] = useState(false);
  const celebrationRef = useRef({ celebrating: false, acknowledged: 0 });
  const endCelebration = React.useCallback(() => {
    celebrationRef.current = { ...celebrationRef.current, celebrating: false };
    setCelebrating(false);
  }, []);
  useEffect(() => {
    const step = nextCelebration({
      celebrating: celebrationRef.current.celebrating,
      completed: completedCount,
      acknowledged: celebrationRef.current.acknowledged,
      recording: isRecording,
      processing: isProcessing,
    });
    celebrationRef.current = { celebrating: step.celebrating, acknowledged: step.acknowledged };
    setCelebrating(step.celebrating);
    if (!step.startTimer) return;
    const id = setTimeout(endCelebration, MANDO_CELEBRATION_MS + 250);
    return () => clearTimeout(id);
  }, [completedCount, isProcessing, isRecording, endCelebration]);
  // Only the full indicator renders the hop; dot/compact users shouldn't wait for it.
  const hopShowing = celebrating && (indicatorMode === "full" || isLiveMode);

  // Auto-hide the floating icon when idle (setting enabled or dictation cycle completed)
  useEffect(() => {
    let hideTimeout;

    if (
      floatingIconAutoHide &&
      !isRecording &&
      !isProcessing &&
      !hopShowing &&
      !liveBusy &&
      toastCount === 0
    ) {
      // Delay briefly so processing can start after recording stops without a
      // flash. Live mode holds its finished frame instead, so it can go at once.
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, liveModeEnabled ? 0 : 500);
    } else if (!floatingIconAutoHide && prevAutoHideRef.current) {
      window.electronAPI?.showDictationPanel?.();
    }

    prevAutoHideRef.current = floatingIconAutoHide;
    return () => clearTimeout(hideTimeout);
  }, [isRecording, isProcessing, hopShowing, liveBusy, liveModeEnabled, floatingIconAutoHide, toastCount]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

  // Determine current mic state
  const getMicState = () => {
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();

  const getMicButtonProps = () => {
    // WhisperWoof: no background on button — the SVG indicator IS the visual
    const baseClasses =
      "w-auto h-auto flex items-center justify-center relative overflow-visible cursor-pointer";

    // The live panel is its own surface: never dim it.
    if (showLivePanel) {
      return { className: baseClasses, tooltip: null };
    }

    switch (micState) {
      case "idle":
      case "hover":
        return {
          className: `${baseClasses} opacity-70 hover:opacity-100 transition-opacity`,
          tooltip: formatHotkeyLabel(hotkey),
        };
      case "recording":
        return {
          className: `${baseClasses}`,
          tooltip: t("app.mic.recording"),
        };
      case "processing":
        return {
          className: `${baseClasses} opacity-80 cursor-not-allowed`,
          tooltip: t("app.mic.processing"),
        };
      default:
        return {
          className: `${baseClasses} opacity-60`,
          tooltip: t("app.mic.clickToSpeak"),
        };
    }
  };

  const micProps = getMicButtonProps();

  const cancelButton = (
    <CancelRecordingButton
      isRecording={isRecording}
      isProcessing={isProcessing}
      onCancelRecording={cancelRecording}
      onCancelProcessing={cancelProcessing}
      recordingLabel={t("app.buttons.cancelRecording")}
      processingLabel={t("app.buttons.cancelProcessing")}
    />
  );

  return (
    <div className="dictation-window">
      {/* Voice button - position determined by panelStartPosition setting */}
      <div
        className={`fixed z-50 ${
          nativeLivePanel
            ? "inset-0"
            : showLivePanel
              ? "bottom-0 left-1/2 -translate-x-1/2" // 112px panel in a 112px-tall window
            : panelStartPosition === "bottom-left"
              ? "bottom-1 left-1"
              : panelStartPosition === "center"
                ? "bottom-1 left-1/2 -translate-x-1/2"
                : "bottom-1 right-1"
        }`}
      >
        <div
          className="relative flex items-center gap-2"
          onMouseEnter={() => {
            setIsHovered(true);
            setWindowInteractivity(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            if (!isCommandMenuOpen) {
              setWindowInteractivity(false);
            }
          }}
        >
          {showLivePanel ? (
            // Over the panel's top-right corner, outside the mic button (no
            // nested buttons).
            <div className="absolute right-3.5 top-2.5 z-10">{cancelButton}</div>
          ) : (
            cancelButton
          )}
          <Tooltip
            content={micProps.tooltip}
            align={
              panelStartPosition === "bottom-left"
                ? "left"
                : panelStartPosition === "center"
                  ? "center"
                  : "right"
            }
          >
            <button
              ref={buttonRef}
              aria-label={
                micState === "recording"
                  ? t("app.mic.ariaRecording", { defaultValue: "Recording. Release to transcribe." })
                  : micState === "processing"
                    ? t("app.mic.ariaProcessing", { defaultValue: "Processing dictation" })
                    : t("app.mic.ariaIdle", { defaultValue: "Start dictation" })
              }
              onMouseDown={(e) => {
                setIsCommandMenuOpen(false);
                setDragStartPos({ x: e.clientX, y: e.clientY });
                setHasDragged(false);
                handleMouseDown(e);
              }}
              onMouseMove={(e) => {
                if (dragStartPos && !hasDragged) {
                  const distance = Math.sqrt(
                    Math.pow(e.clientX - dragStartPos.x, 2) +
                      Math.pow(e.clientY - dragStartPos.y, 2)
                  );
                  if (distance > 5) {
                    // 5px threshold for drag
                    setHasDragged(true);
                  }
                }
              }}
              onMouseUp={(e) => {
                handleMouseUp(e);
                setDragStartPos(null);
              }}
              onClick={(e) => {
                if (!hasDragged) {
                  setIsCommandMenuOpen(false);
                  toggleListening();
                }
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!hasDragged) {
                  setWindowInteractivity(true);
                  setIsCommandMenuOpen((prev) => !prev);
                }
              }}
              onFocus={() => setIsHovered(true)}
              onBlur={() => setIsHovered(false)}
              className={micProps.className}
              style={{
                ...micProps.style,
                cursor:
                  micState === "processing"
                    ? "not-allowed !important"
                    : isDragging
                      ? "grabbing !important"
                      : "pointer !important",
                transition:
                  "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
              }}
            >
              {/* WhisperWoof indicator — Mando head + waveform + status */}
              <div className="flex flex-col items-center">
                {showLivePanel ? (
                  <LiveDictationPanel
                    view={liveFrame}
                    speaking={isSpeaking}
                    celebrating={celebrating}
                    onCelebrationEnd={endCelebration}
                    native={nativeLivePanel}
                    route={dictationRoute}
                    notice={isLiveMode && (isRecording || isProcessing) ? liveNotice : null}
                  />
                ) : (
                <WhisperWoofIndicator
                  state={micState === "recording" ? "recording" : micState === "processing" ? "processing" : "idle"}
                  speaking={isSpeaking}
                  recording={isRecording}
                  celebrating={celebrating}
                  onCelebrationEnd={endCelebration}
                  animated={isRecording || isProcessing}
                  mode={indicatorMode}
                  partialTranscript={partialTranscript}
                  processingPhase={processingPhase}
                  route={dictationRoute}
                />
                )}
              </div>
            </button>
          </Tooltip>
          {isCommandMenuOpen && (
            <div
              ref={commandMenuRef}
              className="absolute bottom-full right-0 mb-3 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-sm"
              onMouseEnter={() => {
                setWindowInteractivity(true);
              }}
              onMouseLeave={() => {
                if (!isHovered) {
                  setWindowInteractivity(false);
                }
              }}
            >
              <button
                className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => {
                  toggleListening();
                }}
              >
                {isRecording
                  ? t("app.commandMenu.stopListening")
                  : t("app.commandMenu.startListening")}
              </button>
              <div className="h-px bg-border" />
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => {
                  setIsCommandMenuOpen(false);
                  setWindowInteractivity(false);
                  handleClose();
                }}
              >
                {t("app.commandMenu.hideForNow")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
