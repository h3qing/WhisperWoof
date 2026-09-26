import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMeetingTranscription } from "../../hooks/useMeetingTranscription";
import { MeetingRecordingPill } from "../../whisperwoof/ui/indicator/MeetingRecordingPill";
import {
  transcriptForNote,
  type ActiveRecording,
} from "../../whisperwoof/ui/notes/meeting-recording";
import { MeetingRecordingContext, useMeetingRecording } from "./useMeetingRecording";

// Meeting and note recordings belong to the control panel, not the Notes view:
// leaving Notes keeps recording, the pill shows it and can stop it, and the
// transcript is saved to its note whichever view is open when it stops.

export function MeetingTranscriptionProvider({ children }: { children: React.ReactNode }) {
  const transcription = useMeetingTranscription();
  const { isRecording, transcript, segments, startTranscription } = transcription;
  const [recording, setRecording] = useState<ActiveRecording | null>(null);

  const startRecording = useCallback(
    async (target: ActiveRecording) => {
      setRecording(target);
      await startTranscription();
    },
    [startTranscription]
  );

  // Save the transcript to its note as the recording stops. `recording` stays
  // set afterwards; it only counts while isRecording, and the next start replaces it.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (wasRecordingRef.current && !isRecording) {
      const text = transcriptForNote(segments, transcript);
      if (recording?.noteId && text) {
        window.electronAPI.updateNote(recording.noteId, { transcript: text });
      }
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording, transcript, segments, recording]);

  const value = { ...transcription, recording, startRecording };
  return (
    <MeetingRecordingContext.Provider value={value}>{children}</MeetingRecordingContext.Provider>
  );
}

/** The recording pill, also for recordings meeting mode doesn't know about. Stop ends them. */
export function ActiveRecordingPill({
  onJumpToNote,
  onStopMeeting,
}: {
  onJumpToNote: (noteId: number) => void;
  onStopMeeting: () => void | Promise<void>;
}) {
  const { isRecording, recording, stopTranscription } = useMeetingRecording();

  const handleStop = useCallback(async () => {
    if (isRecording) await stopTranscription();
    await onStopMeeting();
  }, [isRecording, stopTranscription, onStopMeeting]);

  return (
    <MeetingRecordingPill
      recording={isRecording ? recording : null}
      onJumpToNote={onJumpToNote}
      onStopMeeting={handleStop}
    />
  );
}
