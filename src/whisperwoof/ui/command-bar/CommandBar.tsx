import React, { useState, useEffect, useRef, useCallback } from "react";
import { Command, X } from "lucide-react";
import ReasoningService from "../../../services/ReasoningService";
import { getSettings, getEffectiveReasoningModel } from "../../../stores/settingsStore";

/**
 * Command Bar (Cmd+K) — Type text directly into the WhisperWoof pipeline.
 *
 * Works as a text alternative to voice input. Supports prefix syntax:
 *   /todo Buy milk       → routes to Todoist plugin
 *   /note Meeting notes  → saves as markdown
 *   /project Ideas       → captures to project
 *   (no prefix)          → default paste-at-cursor + polish
 *
 * Polish routes through OpenWhispr's ReasoningService (same path as dictation),
 * gated on the same `useReasoningModel` setting and using the canonical
 * `cleanupPrompt`. No polish when the setting is off or no model selected.
 */

/**
 * Polish text via ReasoningService (mirrors audioManager.processTranscription).
 * Returns { text, polished } where polished=true only if reasoning actually ran.
 */
async function polishViaReasoning(text: string): Promise<{ text: string; polished: boolean }> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return { text: trimmed, polished: false };

  try {
    const settings = getSettings();
    if (!settings.useReasoningModel) return { text: trimmed, polished: false };

    const model = getEffectiveReasoningModel();
    if (!model) return { text: trimmed, polished: false };

    const agentName =
      typeof window !== "undefined" && window.localStorage
        ? window.localStorage.getItem("agentName") || null
        : null;

    const result = await ReasoningService.processText(trimmed, model, agentName);
    const clean = typeof result === "string" ? result.trim() : "";
    if (!clean) return { text: trimmed, polished: false };
    return { text: clean, polished: true };
  } catch {
    return { text: trimmed, polished: false };
  }
}

interface CommandBarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

interface RouteMatch {
  readonly prefix: string;
  readonly label: string;
  readonly destination: string;
}

const ROUTES: readonly RouteMatch[] = [
  { prefix: "/todo", label: "Add to Todoist", destination: "todoist" },
  { prefix: "/note", label: "Save as Markdown", destination: "save-as-markdown" },
  { prefix: "/project", label: "Capture to Project", destination: "project" },
  { prefix: "/slack", label: "Send to Slack", destination: "slack" },
  { prefix: "/cal", label: "Add to Calendar", destination: "calendar" },
];

function matchRoute(input: string): { route: RouteMatch | null; text: string } {
  const trimmed = input.trim();
  for (const route of ROUTES) {
    if (trimmed.startsWith(route.prefix + " ") || trimmed === route.prefix) {
      return {
        route,
        text: trimmed.slice(route.prefix.length).trim(),
      };
    }
  }
  return { route: null, text: trimmed };
}

export default function CommandBar({ isOpen, onClose }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setInput("");
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);

    const { route, text } = matchRoute(trimmed);
    const api = (window as any).electronAPI;

    try {
      if (route?.destination === "save-as-markdown" && text) {
        // Polish first, then save
        const polishResult = await polishViaReasoning(text);
        const polished = polishResult.polished ? polishResult.text : text;
        await api?.whisperwoofSaveMarkdown?.(polished);

        // Save to bf_entries
        await api?.whisperwoofSaveEntry?.({
          source: "voice",
          rawText: text,
          polished: polishResult.polished ? polished : null,
          routedTo: "save-as-markdown",
          hotkeyUsed: "Cmd+K",
          durationMs: null,
          projectId: null,
          audioPath: null,
          metadata: { via: "command-bar" },
        });
      } else if (route?.destination === "project" && text) {
        // For now, save to bf_entries with a project tag in metadata
        await api?.whisperwoofSaveEntry?.({
          source: "voice",
          rawText: text,
          polished: null,
          routedTo: "project",
          hotkeyUsed: "Cmd+K",
          durationMs: null,
          projectId: null,
          audioPath: null,
          metadata: { via: "command-bar", projectHint: text },
        });
      } else {
        // Default: polish and paste at cursor
        const polishResult = await polishViaReasoning(text);
        const polished = polishResult.polished ? polishResult.text : text;
        await api?.pasteText?.(polished);

        await api?.whisperwoofSaveEntry?.({
          source: "voice",
          rawText: text,
          polished: polishResult.polished ? polished : null,
          routedTo: route?.destination || "paste-at-cursor",
          hotkeyUsed: "Cmd+K",
          durationMs: null,
          projectId: null,
          audioPath: null,
          metadata: { via: "command-bar" },
        });
      }
    } catch {
      // Silently fail — entry saved to history anyway
    }

    onClose();
  }, [input, submitting, onClose]);

  const { route } = matchRoute(input);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Command bar */}
      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden">
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Command size={16} className="text-amber-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Type text or /todo, /note, /project…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            disabled={submitting}
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Route indicator */}
        {input.trim() && (
          <div className="px-4 py-2 flex items-center gap-2 text-xs">
            {route ? (
              <>
                <span className="text-amber-500 font-medium">{route.label}</span>
                <span className="text-muted-foreground">↵ Enter to send</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">Paste at cursor</span>
                <span className="text-muted-foreground">↵ Enter to send</span>
              </>
            )}
          </div>
        )}

        {/* Quick hints */}
        {!input.trim() && (
          <div className="px-4 py-2 space-y-1">
            {ROUTES.slice(0, 4).map((r) => (
              <div key={r.prefix} className="flex items-center gap-2 text-xs text-muted-foreground">
                <code className="text-amber-500/70 font-mono">{r.prefix}</code>
                <span>{r.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
