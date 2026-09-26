/**
 * Meeting and note recordings outlive the Notes view: an always-mounted
 * provider (components/notes/MeetingTranscriptionProvider.tsx) owns them, so
 * leaving Notes keeps recording and the recording pill can show and stop it.
 * These are its decisions.
 */
import type { MeetingState } from "../indicator/MeetingRecordingPill";

/** The note a recording saves into, fixed when it starts. */
export interface ActiveRecording {
  noteId: number | null;
  noteTitle: string | null;
  isMeeting: boolean;
}

interface Segment {
  text: string;
  source?: string;
  timestamp?: number;
}

/** What a finished recording saves as its note's transcript, or null for nothing. */
export function transcriptForNote(segments: Segment[], transcript: string): string | null {
  if (segments.length > 0) {
    return JSON.stringify(
      segments.map(({ text, source, timestamp }) => ({ text, source, timestamp }))
    );
  }
  return transcript || null;
}

/** The recording pill: meeting mode's own state, else the recording that is running. */
export function recordingPillState(
  engine: MeetingState,
  recording: ActiveRecording | null
): MeetingState {
  if (engine.isRecording || !recording) return engine;
  return {
    isRecording: true,
    noteId: recording.noteId,
    noteTitle: recording.noteTitle,
    trigger: null,
  };
}
