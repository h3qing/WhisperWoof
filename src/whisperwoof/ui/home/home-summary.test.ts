import { describe, it, expect } from "vitest";
import { homeHeadline, homeFacts, type HomeSummaryInput } from "./home-summary";

const base: HomeSummaryInput = {
  summary: { totalEntries: 1234, todayEntries: 24, thisWeekEntries: 93 },
  streaks: { current: 2 },
  polishStats: { polishRate: 61.3, totalPolished: 57 },
  averageDuration: { avgMs: 10_040, totalMs: 79 * 60_000 },
};

const withSummary = (summary: Partial<HomeSummaryInput["summary"]>): HomeSummaryInput => ({
  ...base,
  summary: { ...base.summary, ...summary },
});

describe("homeHeadline", () => {
  it("states the week's count and how much of it was today", () => {
    expect(homeHeadline(base)).toEqual({ count: 93, rest: "entries in the last 7 days, 24 of them today." });
  });

  it("says none when nothing landed today", () => {
    expect(homeHeadline(withSummary({ todayEntries: 0 })).rest).toBe(
      "entries in the last 7 days, none of them today."
    );
  });

  it("says all when everything this week was today", () => {
    expect(homeHeadline(withSummary({ todayEntries: 5, thisWeekEntries: 5 })).rest).toBe(
      "entries in the last 7 days, all of them today."
    );
  });

  it("treats a today count above the 7-day count as all of them", () => {
    expect(homeHeadline(withSummary({ todayEntries: 9, thisWeekEntries: 7 })).rest).toBe(
      "entries in the last 7 days, all of them today."
    );
  });

  it("uses the singular for one entry", () => {
    expect(homeHeadline(withSummary({ todayEntries: 1, thisWeekEntries: 1 }))).toEqual({
      count: 1,
      rest: "entry in the last 7 days, and it was today.",
    });
    expect(homeHeadline(withSummary({ todayEntries: 0, thisWeekEntries: 1 })).rest).toBe(
      "entry in the last 7 days."
    );
  });

  it("has no count when the week was quiet", () => {
    expect(homeHeadline(withSummary({ todayEntries: 0, thisWeekEntries: 0 }))).toEqual({
      count: null,
      rest: "Nothing new in the last 7 days.",
    });
  });
});

describe("homeFacts", () => {
  it("lists streak, recording length, voice time, cleanup rate and the all-time total", () => {
    expect(homeFacts(base)).toEqual([
      { label: "Streak", value: "2 days" },
      { label: "Average recording", value: "10.0 s" },
      { label: "Voice recorded", value: "79 min" },
      { label: "Cleaned up", value: "61%" },
      { label: "All time", value: "1,234" },
    ]);
  });

  it("uses the singular for a one-day streak", () => {
    expect(homeFacts({ ...base, streaks: { current: 1 } })[0]).toEqual({ label: "Streak", value: "1 day" });
  });

  it("shows seconds of voice until there is a full minute", () => {
    const facts = homeFacts({ ...base, averageDuration: { avgMs: 4_000, totalMs: 45_000 } });
    expect(facts.find((f) => f.label === "Voice recorded")?.value).toBe("45 s");
  });

  it("rounds to seconds before choosing the unit", () => {
    const voice = (totalMs: number) =>
      homeFacts({ ...base, averageDuration: { avgMs: 1_000, totalMs } }).find((f) => f.label === "Voice recorded")?.value;
    expect(voice(59_600)).toBe("1 min");
    expect(voice(400)).toBe("under 1 s");
  });

  it("switches to hours past two hours of voice", () => {
    const facts = homeFacts({ ...base, averageDuration: { avgMs: 9_000, totalMs: 200 * 3_600_000 } });
    expect(facts.find((f) => f.label === "Voice recorded")?.value).toBe("200 h");
  });

  it("leaves out facts with nothing to say", () => {
    const quiet: HomeSummaryInput = {
      summary: { totalEntries: 3, todayEntries: 0, thisWeekEntries: 0 },
      streaks: { current: 0 },
      polishStats: { polishRate: 0, totalPolished: 0 },
      averageDuration: { avgMs: 0, totalMs: 0 },
    };
    expect(homeFacts(quiet)).toEqual([{ label: "All time", value: "3" }]);
  });
});
