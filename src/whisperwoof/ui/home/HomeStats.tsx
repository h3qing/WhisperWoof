/**
 * HomeStats: opens Home with one sentence about the last 7 days, a row of
 * facts, and the activity heatmap.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { homeHeadline, homeFacts } from "./home-summary";

interface Dashboard {
  summary: { totalEntries: number; todayEntries: number; thisWeekEntries: number; thisMonthEntries: number };
  entriesPerDay: { day: string; count: number }[];
  sourceBreakdown: { source: string; count: number }[];
  polishStats: { polishRate: number; totalPolished: number; avgCharsSaved: number; totalRaw: number };
  streaks: { current: number; longest: number };
  busiestHours: number[];
  averageDuration: { avgMs: number; totalMs: number; count: number };
}

function getAPI(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

// --- Heatmap ---

interface DayData { date: string; count: number; }

function buildHeatmapWeeks(entriesPerDay: { day: string; count: number }[], numWeeks: number): DayData[][] {
  const countMap = new Map<string, number>();
  for (const e of entriesPerDay) countMap.set(e.day, e.count);

  const today = new Date();
  const columns: DayData[][] = [];

  for (let w = numWeeks - 1; w >= 0; w--) {
    const week: DayData[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - (w * 7) - (today.getDay() - d));
      const dateStr = date.toISOString().split("T")[0]!;
      week.push({ date: dateStr, count: date > today ? -1 : (countMap.get(dateStr) ?? 0) });
    }
    columns.push(week);
  }
  return columns;
}

function heatColor(count: number, max: number): string {
  if (count < 0) return "transparent";
  if (count === 0) return "color-mix(in srgb, var(--color-foreground) 5%, transparent)";
  const r = count / Math.max(max, 1);
  if (r < 0.25) return "color-mix(in srgb, var(--color-mando) 22%, transparent)";
  if (r < 0.5) return "color-mix(in srgb, var(--color-mando) 42%, transparent)";
  if (r < 0.75) return "color-mix(in srgb, var(--color-mando) 65%, transparent)";
  return "var(--color-mando)";
}

function ActivityHeatmap({ entriesPerDay, onDayClick }: { entriesPerDay: { day: string; count: number }[]; onDayClick?: (date: string) => void }) {
  const [hovered, setHovered] = useState<DayData | null>(null);
  const columns = useMemo(() => buildHeatmapWeeks(entriesPerDay, 26), [entriesPerDay]);
  const maxCount = useMemo(() => {
    let m = 0;
    for (const w of columns) for (const d of w) if (d.count > m) m = d.count;
    return m;
  }, [columns]);

  return (
    <div className="relative ml-auto w-fit max-w-full">
      <div
        style={{
          display: "grid",
          // Cells stay small on wide windows: a wall of big empty squares
          // outweighs the numbers next to it.
          gridTemplateColumns: `repeat(${columns.length}, minmax(0, 13px))`,
          gridTemplateRows: "repeat(7, auto)",
          gap: "3px",
        }}
      >
        {columns.map((week, wi) =>
          week.map((day, di) => (
            <div
              key={`${wi}-${di}`}
              style={{
                gridColumn: wi + 1,
                gridRow: di + 1,
                aspectRatio: "1",
                borderRadius: "3px",
                background: heatColor(day.count, maxCount),
                cursor: day.count >= 0 ? "pointer" : "default",
                transition: "transform 0.1s",
                ...(hovered?.date === day.date && day.count >= 0
                  ? { transform: "scale(1.3)", boxShadow: "0 0 0 1px var(--color-mando-deep)", zIndex: 2, position: "relative" as const }
                  : {}),
              }}
              onMouseEnter={() => day.count >= 0 && setHovered(day)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => day.count > 0 && onDayClick?.(day.date)}
            />
          ))
        )}
      </div>
      {hovered && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full glass-thick text-xs text-foreground whitespace-nowrap z-10 pointer-events-none tabular-nums">
          <span className="font-semibold">{hovered.count}</span> entries · {new Date(hovered.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      )}
      <div className="flex justify-between mt-1.5 text-[11px] text-faint">
        <span>26 weeks ago</span>
        <span>today</span>
      </div>
    </div>
  );
}

// --- Main ---

interface HomeStatsProps {
  onDayClick?: (date: string) => void;
}

export default function HomeStats({ onDayClick }: HomeStatsProps) {
  const [data, setData] = useState<Dashboard | null>(null);

  const fetchData = useCallback(async () => {
    const api = getAPI();
    try {
      if (typeof api.whisperwoofGetAnalytics === "function")
        setData(await (api.whisperwoofGetAnalytics as () => Promise<Dashboard>)());
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live refresh: dictation runs in the overlay window, so this panel never
  // sees it directly. The main process broadcasts after each saved entry;
  // window focus refetches as a catch-all for anything missed while hidden.
  useEffect(() => {
    const api = getAPI() as { onWhisperwoofEntrySaved?: (cb: () => void) => () => void };
    const disposeSaved = api.onWhisperwoofEntrySaved?.(() => fetchData());
    const onFocus = () => fetchData();
    window.addEventListener("focus", onFocus);
    return () => {
      disposeSaved?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchData]);

  if (!data || data.summary.totalEntries === 0) return null;

  const headline = homeHeadline(data);
  const facts = homeFacts(data);

  return (
    <div className="rounded-[var(--radius-sheet)] bg-card shadow-card px-5 pt-5 pb-5 mb-1">
      <div className="flex gap-8 items-start">
        <div className="flex-1 min-w-0">
          <p className="text-[26px] font-extrabold leading-[1.2] tracking-[-0.022em] text-foreground max-w-[30ch] text-balance">
            {headline.count !== null && (
              <span className="text-primary tabular-nums">{headline.count.toLocaleString("en-US")} </span>
            )}
            {headline.rest}
          </p>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 mt-4">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[13px] font-medium text-muted-foreground">{fact.label}</dt>
                <dd className="text-[19px] font-bold tracking-[-0.01em] text-foreground tabular-nums whitespace-nowrap">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="shrink-0 max-w-[50%] pt-1 hidden md:block">
          <ActivityHeatmap entriesPerDay={data.entriesPerDay || []} onDayClick={onDayClick} />
        </div>
      </div>
    </div>
  );
}
