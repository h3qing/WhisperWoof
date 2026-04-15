/**
 * HomeStats — "Mando's Journal" with full-width heatmap + AI fun facts
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../../../components/lib/utils";

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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// --- Data-driven fun facts (instant, no LLM needed) ---

function generateFunFacts(d: Dashboard): string[] {
  const facts: string[] = [];

  // Busiest hour
  if (d.busiestHours?.some((h) => h > 0)) {
    const maxH = d.busiestHours.indexOf(Math.max(...d.busiestHours));
    const t = maxH === 0 ? "midnight" : maxH < 12 ? `${maxH}am` : maxH === 12 ? "noon" : `${maxH - 12}pm`;
    facts.push(`Your peak hour is ${t}`);
  }

  // Streak
  if (d.streaks.longest > 1) facts.push(`Longest streak: ${d.streaks.longest} days`);

  // Polish
  if (d.polishStats.totalPolished > 0) {
    const saved = Math.round(d.polishStats.avgCharsSaved * d.polishStats.totalPolished);
    if (saved > 0) facts.push(`${saved.toLocaleString()} chars of filler removed by AI`);
    facts.push(`${Math.round(d.polishStats.polishRate)}% of entries get AI polish`);
  }

  // Duration
  if (d.averageDuration.avgMs > 0) {
    facts.push(`Average recording: ${(d.averageDuration.avgMs / 1000).toFixed(1)}s`);
    const totalMin = Math.round(d.averageDuration.totalMs / 60000);
    if (totalMin > 1) facts.push(`${totalMin} minutes of voice recorded total`);
  }

  // Source breakdown
  const voice = d.sourceBreakdown.find((s) => s.source === "voice");
  const clip = d.sourceBreakdown.find((s) => s.source === "clipboard");
  if (voice && voice.count > 0) facts.push(`${voice.count} voice entries captured`);
  if (clip && clip.count > 0) facts.push(`${clip.count} clipboard items saved`);

  // Month vs week
  if (d.summary.thisMonthEntries > 0 && d.summary.thisWeekEntries > 0) {
    const weeklyRate = d.summary.thisWeekEntries;
    const monthlyAvg = Math.round(d.summary.thisMonthEntries / 4);
    if (weeklyRate > monthlyAvg * 1.2) facts.push("This week is above your monthly average");
    else if (weeklyRate < monthlyAvg * 0.8) facts.push("Quieter week than usual");
  }

  // Total
  facts.push(`${d.summary.totalEntries.toLocaleString()} entries all time`);

  return facts;
}

// Pick 2-3 facts that rotate throughout the day
function pickFacts(facts: string[], count: number = 3): string[] {
  if (facts.length <= count) return facts;
  const hourSeed = Math.floor(Date.now() / 3600000); // changes every hour
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(facts[(hourSeed + i) % facts.length]!);
  }
  return picked;
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
  if (count === 0) return "rgba(255,255,255,0.03)";
  const r = count / Math.max(max, 1);
  if (r < 0.25) return "rgba(160,106,60,0.15)";
  if (r < 0.5) return "rgba(160,106,60,0.3)";
  if (r < 0.75) return "rgba(160,106,60,0.55)";
  return "rgba(160,106,60,0.8)";
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
    <div className="relative w-full">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
          gridTemplateRows: "repeat(7, 1fr)",
          gap: "2px",
          width: "100%",
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
                borderRadius: "2px",
                background: heatColor(day.count, maxCount),
                cursor: day.count >= 0 ? "pointer" : "default",
                transition: "transform 0.1s",
                ...(hovered?.date === day.date && day.count >= 0
                  ? { transform: "scale(1.3)", boxShadow: "0 0 0 1px rgba(160,106,60,0.5)", zIndex: 2, position: "relative" as const }
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
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-[#1A1714] border border-[#2E2923] text-[10px] text-[#E8DDD0] whitespace-nowrap z-10 pointer-events-none shadow-lg">
          <span className="font-semibold">{hovered.count}</span> entries · {new Date(hovered.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      )}
      <div className="flex justify-between mt-1 text-[9px] text-[#736858]">
        <span>26 weeks ago</span>
        <span>today</span>
      </div>
    </div>
  );
}

// --- AI-generated insight (uses Ollama if available) ---

function useAIInsight(data: Dashboard | null): string | null {
  const [insight, setInsight] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    // Check cache first (refreshes every 6 hours)
    const cacheKey = "whisperwoof-ai-insight";
    const cacheTimeKey = "whisperwoof-ai-insight-ts";
    const cached = localStorage.getItem(cacheKey);
    const cachedTs = parseInt(localStorage.getItem(cacheTimeKey) || "0");
    if (cached && Date.now() - cachedTs < 6 * 3600 * 1000) {
      setInsight(cached);
      return;
    }

    // Try LLM generation
    const api = getAPI();
    if (typeof api.whisperwoofPolishText !== "function") return;

    const statsPrompt = `You are a fun, concise assistant for a voice dictation app called WhisperWoof. Based on these user stats, write ONE short fun observation (under 15 words). Be warm, specific, playful. No emojis. Examples: "You talk more on Tuesdays than any other day" or "Your voice entries are getting longer this month".

Stats: ${data.summary.todayEntries} entries today, ${data.summary.thisWeekEntries} this week, ${data.summary.thisMonthEntries} this month, ${data.streaks.current}-day streak (best: ${data.streaks.longest}), ${data.summary.totalEntries} total entries, busiest hour: ${data.busiestHours ? data.busiestHours.indexOf(Math.max(...data.busiestHours)) : "unknown"}:00, avg recording: ${data.averageDuration.avgMs > 0 ? (data.averageDuration.avgMs / 1000).toFixed(1) + "s" : "n/a"}.

Write ONLY the observation, nothing else:`;

    (api.whisperwoofPolishText as (text: string, opts: Record<string, unknown>) => Promise<string | null>)(
      statsPrompt, { preset: "minimal" }
    ).then((result) => {
      if (result && result.length > 5 && result.length < 100) {
        setInsight(result.trim());
        localStorage.setItem(cacheKey, result.trim());
        localStorage.setItem(cacheTimeKey, String(Date.now()));
      }
    }).catch(() => { /* Ollama not available, use static facts */ });
  }, [data]);

  return insight;
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

  const funFacts = useMemo(() => data ? pickFacts(generateFunFacts(data), 3) : [], [data]);
  const aiInsight = useAIInsight(data);

  if (!data || data.summary.totalEntries === 0) return null;

  const { summary, streaks, entriesPerDay, sourceBreakdown } = data;

  const voice = sourceBreakdown.find((s) => s.source === "voice");
  const total = sourceBreakdown.reduce((sum, s) => sum + s.count, 0);
  const voicePct = total > 0 && voice ? Math.round((voice.count / total) * 100) : 0;

  const parts: string[] = [];
  parts.push(`${summary.todayEntries} today`);
  if (streaks.current > 0) parts.push(`${streaks.current}-day streak`);
  if (voicePct > 0) parts.push(`${voicePct}% voice`);

  return (
    <div className="pt-2 pb-3 mb-1">
      <div className="flex gap-6 items-start">
        {/* Left: greeting + hero + fun facts */}
        <div className="shrink-0 w-[220px]">
          <p className="text-[13px] text-[#736858]">{getGreeting()}</p>
          <h2 className="text-[26px] font-extrabold tracking-tight leading-tight mt-0.5">
            <span className="text-[#A06A3C]">{summary.thisWeekEntries}</span>
            <span className="text-[#E8DDD0]"> this week</span>
          </h2>
          <p className="text-[11px] text-[#736858] mt-1">{parts.join(" · ")}</p>

          {/* Fun facts / AI insight */}
          <div className="mt-3 space-y-1.5">
            {aiInsight && (
              <p className="text-[11px] text-[#A06A3C]/70 flex items-start gap-1.5">
                <Sparkles size={10} className="shrink-0 mt-0.5" />
                <span>{aiInsight}</span>
              </p>
            )}
            {funFacts.map((fact, i) => (
              <p key={i} className="text-[10px] text-[#736858]/70">
                {fact}
              </p>
            ))}
          </div>
        </div>

        {/* Right: heatmap */}
        <div className="flex-1 min-w-0 pt-1">
          <ActivityHeatmap entriesPerDay={entriesPerDay || []} onDayClick={onDayClick} />
        </div>
      </div>
    </div>
  );
}
