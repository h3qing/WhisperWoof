import { describe, it, expect } from "vitest";
import { recordingPillState, transcriptForNote, type ActiveRecording } from "./meeting-recording";
import type { MeetingState } from "../indicator/MeetingRecordingPill";

const idle: MeetingState = { isRecording: false, noteId: null, noteTitle: null, trigger: null };
const meetingMode: MeetingState = {
  isRecording: true,
  noteId: 7,
  noteTitle: "Standup",
  trigger: "calendar-join",
};
const noteRecording: ActiveRecording = { noteId: 12, noteTitle: "Ideas", isMeeting: false };

describe("transcriptForNote", () => {
  it("saves the segments, with only the fields the note keeps", () => {
    const segments = [
      { id: "seg-1", text: "hello", source: "mic", timestamp: 1 },
      { id: "seg-2", text: "hi", source: "system", timestamp: 2 },
    ];
    expect(JSON.parse(transcriptForNote(segments, "hello hi")!)).toEqual([
      { text: "hello", source: "mic", timestamp: 1 },
      { text: "hi", source: "system", timestamp: 2 },
    ]);
  });

  it("falls back to the plain transcript, and saves nothing when there is none", () => {
    expect(transcriptForNote([], "just text")).toBe("just text");
    expect(transcriptForNote([], "")).toBeNull();
  });
});

describe("recordingPillState", () => {
  it("shows a recording that meeting mode doesn't know about, e.g. after leaving the Notes view", () => {
    expect(recordingPillState(idle, noteRecording)).toEqual({
      isRecording: true,
      noteId: 12,
      noteTitle: "Ideas",
      trigger: null,
    });
  });

  it("keeps meeting mode's own state while it has one", () => {
    expect(recordingPillState(meetingMode, noteRecording)).toBe(meetingMode);
    expect(recordingPillState(meetingMode, null)).toBe(meetingMode);
  });

  it("stays hidden with nothing recording", () => {
    expect(recordingPillState(idle, null)).toBe(idle);
  });
});
