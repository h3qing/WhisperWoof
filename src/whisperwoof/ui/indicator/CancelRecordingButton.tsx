import { X } from "lucide-react";

export interface CancelRecordingButtonProps {
  isRecording: boolean;
  isProcessing: boolean;
  onCancelRecording: () => void;
  onCancelProcessing: () => void;
  recordingLabel: string;
  processingLabel: string;
}

export function CancelRecordingButton({
  isRecording,
  isProcessing,
  onCancelRecording,
  onCancelProcessing,
  recordingLabel,
  processingLabel,
}: CancelRecordingButtonProps) {
  if (!isRecording && !isProcessing) return null;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isRecording) {
      onCancelRecording();
    } else {
      onCancelProcessing();
    }
  };

  return (
    <button
      type="button"
      aria-label={isRecording ? recordingLabel : processingLabel}
      onClick={handleClick}
      className="group/cancel w-5 h-5 rounded-full bg-surface-2/90 hover:bg-destructive border border-border hover:border-destructive/70 flex items-center justify-center transition-colors duration-150 shadow-sm backdrop-blur-sm"
    >
      <X
        size={10}
        strokeWidth={2.5}
        className="text-foreground group-hover/cancel:text-destructive-foreground transition-colors duration-150"
      />
    </button>
  );
}
