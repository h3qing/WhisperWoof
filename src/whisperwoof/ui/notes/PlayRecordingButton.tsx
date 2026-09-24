import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";

// Plays the dictation a voice note came from (the note's `entry`).

interface RecordingApi {
  whisperwoofEntryRecordingId?: (entryId: string) => Promise<{ success: boolean; recordingId?: number | null }>;
  getAudioBuffer?: (id: number) => Promise<ArrayBuffer | null>;
}

const api = () => (window as unknown as { electronAPI?: RecordingApi }).electronAPI;

export function PlayRecordingButton({ entryId }: { entryId: string }) {
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecordingId(null);
    api()
      ?.whisperwoofEntryRecordingId?.(entryId)
      .then((result) => {
        if (!cancelled && result?.success) setRecordingId(result.recordingId ?? null);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [entryId]);

  function stop() {
    const current = audio.current;
    if (current) {
      current.pause();
      URL.revokeObjectURL(current.src);
      audio.current = null;
    }
    setPlaying(false);
  }

  async function play() {
    if (recordingId == null) return;
    const buffer = await api()?.getAudioBuffer?.(recordingId);
    if (!buffer) return;
    stop();
    const element = new Audio(URL.createObjectURL(new Blob([buffer], { type: "audio/webm" })));
    element.onended = stop;
    audio.current = element;
    setPlaying(true);
    await element.play().catch(stop);
  }

  if (recordingId == null) return null;

  return (
    <button
      onClick={playing ? stop : play}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
    >
      {playing ? <Square size={11} aria-hidden="true" /> : <Play size={11} aria-hidden="true" />}
      {playing ? "Stop" : "Play recording"}
    </button>
  );
}
