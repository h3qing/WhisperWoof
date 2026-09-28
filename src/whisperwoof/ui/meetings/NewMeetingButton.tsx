import { Mic } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useMeetingRecording } from "../../../components/notes/useMeetingRecording";
import { useStartMeeting } from "./useStartMeeting";

/**
 * The Meetings view's one primary action. A component of its own so that
 * only it re-renders as a meeting's transcript streams in, not the panel.
 */
export function NewMeetingButton() {
  const { isRecording } = useMeetingRecording();
  const { startMeeting, isStarting } = useStartMeeting();
  return (
    <Button
      onClick={() => startMeeting()}
      disabled={isRecording || isStarting}
      className="h-9 pl-3 pr-4 gap-2"
    >
      <Mic size={16} strokeWidth={2} />
      New meeting
    </Button>
  );
}
