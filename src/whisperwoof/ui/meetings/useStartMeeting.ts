import { useCallback, useRef, useState } from "react";
import { useToast } from "../../../components/ui/Toast";

/**
 * Starts a meeting now: New meeting, or Record on an event coming up (the
 * note gets its title). Says so when it didn't start, and ignores clicks
 * while one is starting.
 */
export function useStartMeeting() {
  const { toast } = useToast();
  const [isStarting, setIsStarting] = useState(false);
  const startingRef = useRef(false);

  const startMeeting = useCallback(
    async (title?: string) => {
      if (startingRef.current) return;
      startingRef.current = true;
      setIsStarting(true);
      try {
        const result = await window.electronAPI?.startNewMeeting?.(title ? { title } : undefined);
        if (result && !result.success) {
          toast({
            title: "The meeting didn't start",
            description: result.error,
            variant: "destructive",
          });
        }
      } finally {
        startingRef.current = false;
        setIsStarting(false);
      }
    },
    [toast]
  );

  return { startMeeting, isStarting };
}
