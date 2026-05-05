import { describe, it, expect, vi } from "vitest";
import { MeetingRecordingPillView, type MeetingState } from "./MeetingRecordingPill";

interface ElementLike {
  type: unknown;
  props: Record<string, unknown>;
}

function isElement(value: unknown): value is ElementLike {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findChild(element: ElementLike, predicate: (child: unknown) => boolean): ElementLike | null {
  const children = element.props.children;
  if (!children) return null;
  const list = Array.isArray(children) ? children.flat(Infinity) : [children];
  for (const child of list) {
    if (predicate(child) && isElement(child)) return child;
    if (isElement(child)) {
      const nested = findChild(child, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function findByRole(root: ReturnType<typeof MeetingRecordingPillView>, role: string): ElementLike | null {
  if (!isElement(root)) return null;
  if (root.props.role === role) return root;
  return findChild(root, (c) => isElement(c) && c.props.role === role);
}

function findByAriaLabel(
  root: ReturnType<typeof MeetingRecordingPillView>,
  label: string,
): ElementLike | null {
  if (!isElement(root)) return null;
  if (root.props["aria-label"] === label) return root;
  return findChild(root, (c) => isElement(c) && c.props["aria-label"] === label);
}

const ACTIVE_STATE: MeetingState = {
  isRecording: true,
  noteId: 42,
  noteTitle: "Standup",
  trigger: "manual",
};

const IDLE_STATE: MeetingState = {
  isRecording: false,
  noteId: null,
  noteTitle: null,
  trigger: null,
};

describe("MeetingRecordingPillView", () => {
  it("renders nothing when isRecording=false", () => {
    expect(MeetingRecordingPillView({ state: IDLE_STATE })).toBeNull();
  });

  it("renders the meeting title when active", () => {
    const el = MeetingRecordingPillView({ state: ACTIVE_STATE });
    const banner = findByRole(el, "status");
    expect(banner).not.toBeNull();
    expect(banner?.props["aria-label"]).toBe("Meeting recording: Standup");
  });

  it("falls back to 'Meeting' when noteTitle is null", () => {
    const el = MeetingRecordingPillView({ state: { ...ACTIVE_STATE, noteTitle: null } });
    const banner = findByRole(el, "status");
    expect(banner?.props["aria-label"]).toBe("Meeting recording: Meeting");
  });

  it("falls back to 'Meeting' when noteTitle is whitespace-only", () => {
    const el = MeetingRecordingPillView({ state: { ...ACTIVE_STATE, noteTitle: "   " } });
    const banner = findByRole(el, "status");
    expect(banner?.props["aria-label"]).toBe("Meeting recording: Meeting");
  });

  it("calls onJumpToNote with the noteId when banner clicked", () => {
    const onJumpToNote = vi.fn();
    const el = MeetingRecordingPillView({ state: ACTIVE_STATE, onJumpToNote });
    const banner = findByRole(el, "status");
    const onClick = banner?.props.onClick as () => void;
    onClick();
    expect(onJumpToNote).toHaveBeenCalledWith(42);
  });

  it("does not call onJumpToNote when noteId is null", () => {
    const onJumpToNote = vi.fn();
    const el = MeetingRecordingPillView({
      state: { ...ACTIVE_STATE, noteId: null },
      onJumpToNote,
    });
    const banner = findByRole(el, "status");
    const onClick = banner?.props.onClick as () => void;
    onClick();
    expect(onJumpToNote).not.toHaveBeenCalled();
  });

  it("renders a stop button with correct aria-label", () => {
    const el = MeetingRecordingPillView({ state: ACTIVE_STATE });
    expect(findByAriaLabel(el, "Stop meeting")).not.toBeNull();
  });

  it("calls onStopMeeting and stops propagation when stop is clicked", () => {
    const onStopMeeting = vi.fn();
    const onJumpToNote = vi.fn();
    const el = MeetingRecordingPillView({
      state: ACTIVE_STATE,
      onStopMeeting,
      onJumpToNote,
    });
    const stopButton = findByAriaLabel(el, "Stop meeting");
    const onClick = stopButton?.props.onClick as (e: { stopPropagation: () => void }) => void;
    const stopPropagation = vi.fn();
    onClick({ stopPropagation });
    expect(onStopMeeting).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onJumpToNote).not.toHaveBeenCalled();
  });

  it("does not throw when onJumpToNote/onStopMeeting are omitted", () => {
    const el = MeetingRecordingPillView({ state: ACTIVE_STATE });
    const banner = findByRole(el, "status");
    const onClick = banner?.props.onClick as () => void;
    expect(() => onClick()).not.toThrow();

    const stopButton = findByAriaLabel(el, "Stop meeting");
    const stopOnClick = stopButton?.props.onClick as (e: { stopPropagation: () => void }) => void;
    expect(() => stopOnClick({ stopPropagation: () => {} })).not.toThrow();
  });
});
