import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../components/lib/utils";
import type { CalendarEvent } from "../../../types/calendar";
import { comingUpToday } from "./meetings-list";

const REFRESH_MS = 60_000;

const startTime = (event: CalendarEvent) =>
  new Date(event.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The Meetings tab's calendar: today's events still to come, the next one
 * highlighted, each with Record. Nothing shows without a connected calendar
 * or anything left today.
 */
export function ComingUpToday({
  events,
  recordingDisabled,
  onRecord,
}: {
  events: CalendarEvent[];
  recordingDisabled: boolean;
  onRecord: (event: CalendarEvent) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const upcoming = comingUpToday(events, now);
  if (upcoming.length === 0) return null;

  return (
    <section aria-label="Coming up today" className="px-1.5 pb-1">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
        <Calendar size={14} className="text-primary" />
        <span className="text-[13px] font-bold text-foreground">Coming up today</span>
      </div>
      {upcoming.map((event, i) => {
        const title = event.summary || "Untitled event";
        return (
          <div
            key={event.id}
            className={cn(
              "flex items-center gap-2.5 px-2 py-1.5 rounded-lg",
              i === 0 && "bg-surface-3"
            )}
          >
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-foreground">
              {startTime(event)}
            </span>
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[13px] font-bold text-foreground truncate">{title}</span>
              {event.attendees_count > 1 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {event.attendees_count} people
                </span>
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={recordingDisabled}
              onClick={() => onRecord(event)}
              aria-label={`Record ${title}`}
              className="h-7 px-3 shrink-0"
            >
              Record
            </Button>
          </div>
        );
      })}
      <div className="mx-2 mt-2 h-px bg-border" />
    </section>
  );
}
