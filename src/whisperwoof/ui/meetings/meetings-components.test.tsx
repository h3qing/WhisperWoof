/**
 * The Meetings tab's two list controls, rendered to HTML: the calendar's
 * "Coming up today" and the folder capsule.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComingUpToday } from "./ComingUpToday";
import { FolderFilter } from "./FolderFilter";
import type { CalendarEvent } from "../../../types/calendar";
import type { FolderItem } from "../../../types/electron";

const event = (id: string, startH: number, attendees = 4) =>
  ({
    id,
    calendar_id: "c",
    summary: id,
    start_time: new Date(2026, 8, 28, startH, 0).toISOString(),
    end_time: new Date(2026, 8, 28, startH + 1, 0).toISOString(),
    is_all_day: 0,
    status: "confirmed",
    hangout_link: null,
    conference_data: null,
    organizer_email: null,
    attendees_count: attendees,
  }) as CalendarEvent;

describe("ComingUpToday", () => {
  afterEach(() => vi.useRealTimers());

  it("shows nothing when nothing is left today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 28, 18, 0));
    const html = renderToStaticMarkup(
      <ComingUpToday events={[event("Standup", 9)]} recordingDisabled={false} onRecord={() => {}} />
    );
    expect(html).toBe("");
  });

  it("lists what's left today with a Record button each, off while a meeting records", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 28, 11, 0));
    const events = [event("Interview", 15, 3), event("Standup", 11, 6)];
    const idle = renderToStaticMarkup(
      <ComingUpToday events={events} recordingDisabled={false} onRecord={() => {}} />
    );
    expect(idle).toContain("Coming up today");
    expect(idle.indexOf("Standup")).toBeLessThan(idle.indexOf("Interview"));
    expect(idle).toContain("6 people");
    expect(idle).toContain('aria-label="Record Standup"');
    expect(idle).not.toContain('disabled=""');

    const busy = renderToStaticMarkup(
      <ComingUpToday events={events} recordingDisabled onRecord={() => {}} />
    );
    expect(busy.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("FolderFilter", () => {
  const folders = [
    { id: 1, name: "Personal", is_default: 1 },
    { id: 2, name: "Meetings", is_default: 1 },
    { id: 3, name: "Client calls", is_default: 0 },
  ] as unknown as FolderItem[];

  it("names the folder being shown and how many notes it holds", () => {
    const html = renderToStaticMarkup(
      <FolderFilter
        folders={folders}
        counts={{ 1: 3, 2: 5 }}
        activeFolderId={2}
        onSelect={() => {}}
        onNewFolder={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
    );
    expect(html).toContain("Meetings");
    expect(html).toContain(">5<");
    expect(html).toContain('aria-expanded="false"');
  });
});
