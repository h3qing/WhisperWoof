import { useEffect, useState } from "react";
import { Mic, Square } from "lucide-react";

export interface MeetingState {
  isRecording: boolean;
  noteId: number | null;
  noteTitle: string | null;
  trigger: "manual" | "calendar-join" | "auto-detect" | null;
}

const INITIAL_STATE: MeetingState = {
  isRecording: false,
  noteId: null,
  noteTitle: null,
  trigger: null,
};

export interface MeetingRecordingPillViewProps {
  state: MeetingState;
  onJumpToNote?: (noteId: number) => void;
  onStopMeeting?: () => void;
}

export function MeetingRecordingPillView({
  state,
  onJumpToNote,
  onStopMeeting,
}: MeetingRecordingPillViewProps) {
  if (!state.isRecording) return null;

  const title = state.noteTitle?.trim() || "Meeting";

  const handleJump = () => {
    if (state.noteId != null && onJumpToNote) onJumpToNote(state.noteId);
  };

  const handleStop = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onStopMeeting?.();
  };

  return (
    <div
      role="status"
      aria-label={`Meeting recording: ${title}`}
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-1/95 dark:bg-surface-2/95 backdrop-blur-md border border-border/50 shadow-lg cursor-pointer hover:border-primary/40 transition-colors"
      onClick={handleJump}
    >
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse"
      />
      <Mic size={11} className="text-foreground/80" aria-hidden />
      <span className="text-xs font-medium text-foreground max-w-[200px] truncate">{title}</span>
      <button
        type="button"
        aria-label="Stop meeting"
        onClick={handleStop}
        className="ml-1 w-5 h-5 rounded-full hover:bg-destructive/15 flex items-center justify-center transition-colors"
      >
        <Square size={10} strokeWidth={2.5} className="text-foreground/70 hover:text-destructive" />
      </button>
    </div>
  );
}

export interface MeetingRecordingPillProps {
  onJumpToNote?: (noteId: number) => void;
  onStopMeeting?: () => void;
}

function defaultSubscribe(callback: (state: MeetingState) => void): () => void {
  const api = (window as unknown as { electronAPI?: { onMeetingState?: (cb: (state: MeetingState) => void) => () => void } }).electronAPI;
  if (!api?.onMeetingState) return () => {};
  return api.onMeetingState(callback);
}

export function MeetingRecordingPill({
  onJumpToNote,
  onStopMeeting,
}: MeetingRecordingPillProps) {
  const [state, setState] = useState<MeetingState>(INITIAL_STATE);

  useEffect(() => {
    return defaultSubscribe(setState);
  }, []);

  return (
    <MeetingRecordingPillView
      state={state}
      onJumpToNote={onJumpToNote}
      onStopMeeting={onStopMeeting}
    />
  );
}
