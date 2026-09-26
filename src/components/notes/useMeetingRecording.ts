import { createContext, useContext } from "react";
import type { useMeetingTranscription } from "../../hooks/useMeetingTranscription";
import type { ActiveRecording } from "../../whisperwoof/ui/notes/meeting-recording";

type MeetingTranscription = ReturnType<typeof useMeetingTranscription>;

/** The control panel's recording (MeetingTranscriptionProvider), for any view. */
export interface MeetingRecording extends MeetingTranscription {
  /** The note the running recording saves into (the last one's, while idle). */
  recording: ActiveRecording | null;
  startRecording: (target: ActiveRecording) => Promise<void>;
}

export const MeetingRecordingContext = createContext<MeetingRecording | null>(null);

export function useMeetingRecording(): MeetingRecording {
  const value = useContext(MeetingRecordingContext);
  if (!value)
    throw new Error("useMeetingRecording must be used inside MeetingTranscriptionProvider");
  return value;
}
