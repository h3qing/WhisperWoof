/**
 * Tests for the Fn press-and-hold / double-tap-latch state machine.
 * Imports the real bridge module main.js wires, so drift is impossible.
 */
import { describe, it, expect } from "vitest";
import {
  createFnActivationMachine,
  TIMER_HOLD_START,
  TIMER_TAP_DECISION,
} from "../../../helpers/fnActivationMachine.js";

type Action = { type: string; id?: string; seq?: number; delayMs?: number };

function types(actions: Action[]): string[] {
  return actions.map((a) => a.type + (a.id ? `:${a.id}` : ""));
}

/** Drives the machine like main.js does: fires armTimer requests on schedule. */
function harness() {
  const m = createFnActivationMachine();
  const timers: Array<{ id: string; seq: number; at: number }> = [];
  const log: string[] = [];

  const run = (actions: Action[], now: number) => {
    for (const a of actions) {
      if (a.type === "armTimer") {
        timers.push({ id: a.id!, seq: a.seq!, at: now + a.delayMs! });
      } else {
        log.push(a.type);
      }
    }
  };

  return {
    log,
    press: (now: number) => run(m.press(now) as Action[], now),
    release: (now: number) => run(m.release(now) as Action[], now),
    /** Fire every armed timer whose deadline has passed, in order. */
    advanceTo: (now: number) => {
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= now) {
        const t = timers.shift()!;
        run(m.fire(t.id, t.at, t.seq) as Action[], t.at);
      }
    },
    state: () => m.getState(),
  };
}

describe("classic push-to-talk (hold)", () => {
  it("starts recording 75ms after press and processes immediately on release", () => {
    const h = harness();
    h.press(1000);
    h.advanceTo(1075);
    expect(h.log).toEqual(["showPanel", "startRecording"]);
    h.release(3000); // held 2s — a real dictation
    expect(h.log).toEqual(["showPanel", "startRecording", "stopAndProcess"]);
    expect(h.state()).toBe("idle");
  });

  it("adds zero latency to a hold release — no timer stands between release and process", () => {
    const h = harness();
    h.press(0);
    h.advanceTo(75);
    const before = h.log.length;
    h.release(400); // 400ms > tapMaxMs → hold path
    expect(h.log.slice(before)).toEqual(["stopAndProcess"]); // synchronous, no armTimer
  });

  it("a brush shorter than 75ms held past tapMax just hides the panel", () => {
    // Impossible in practice (tapMax > minHold) but the machine must not crash.
    const h = harness();
    h.press(0);
    h.release(300); // holdStart timer never fired
    expect(h.log).toEqual(["showPanel", "hidePanel"]);
  });
});

describe("double-tap latch", () => {
  it("tap-tap latches; recording from the FIRST press keeps running", () => {
    const h = harness();
    h.press(0);
    h.advanceTo(75); // recording started
    h.release(150); // tap (<250ms)
    h.press(300); // second tap inside 300ms window
    expect(h.log).toEqual(["showPanel", "startRecording"]); // no stop, no restart
    expect(h.state()).toBe("latched");
    h.release(360); // release of second tap is consumed
    h.advanceTo(5000); // stale timers must not fire into the latch
    expect(h.log).toEqual(["showPanel", "startRecording"]);
  });

  it("starts recording on the second tap when the first was too quick to start it", () => {
    const h = harness();
    h.press(0);
    h.release(50); // released before the 75ms hold threshold
    h.press(200);
    expect(h.log).toEqual(["showPanel", "startRecording"]);
    expect(h.state()).toBe("latched");
  });

  it("a single press while latched stops and processes, on key-down", () => {
    const h = harness();
    h.press(0);
    h.advanceTo(75);
    h.release(150);
    h.press(300); // latched
    h.press(2000); // stop tap — down, not up
    expect(h.log).toEqual(["showPanel", "startRecording", "stopAndProcess"]);
    expect(h.state()).toBe("idle");
    h.release(2060); // its release is consumed
    h.advanceTo(9999);
    expect(h.log).toEqual(["showPanel", "startRecording", "stopAndProcess"]);
  });
});

describe("stray single tap", () => {
  it("cancels quietly — never pastes a 150ms blip", () => {
    const h = harness();
    h.press(0);
    h.advanceTo(75);
    h.release(150); // tap
    h.advanceTo(451); // 300ms window expires with no second tap
    expect(h.log).toEqual(["showPanel", "startRecording", "cancelRecording", "hidePanel"]);
    expect(h.state()).toBe("idle");
  });

  it("a sub-75ms tap still opens the mic during the tap window, then cancels cleanly", () => {
    // The holdStart timer outlives a quick release on purpose: if a second
    // tap follows (latch), recording began at 75ms instead of at the second
    // press — more of the opening words survive. With no second tap, the
    // recording is discarded and nothing pastes.
    const h = harness();
    h.press(0);
    h.release(50);
    h.advanceTo(351);
    expect(h.log).toEqual(["showPanel", "startRecording", "cancelRecording", "hidePanel"]);
  });
});

describe("guards", () => {
  it("ignores a press inside the post-stop cooldown", () => {
    const h = harness();
    h.press(0);
    h.advanceTo(75);
    h.release(400); // hold → processed, stop at t=400
    h.press(450); // 50ms later — inside 100ms cooldown
    expect(h.log).toEqual(["showPanel", "startRecording", "stopAndProcess"]);
    h.press(600); // past cooldown — works again
    expect(h.log.filter((t) => t === "showPanel").length).toBe(2);
  });

  it("ignores duplicate key-down while pressed", () => {
    const h = harness();
    h.press(0);
    h.press(10);
    h.advanceTo(75);
    expect(h.log).toEqual(["showPanel", "startRecording"]);
  });

  it("a stale holdStart timer from a finished press never starts a ghost recording", () => {
    const h = harness();
    h.press(0);
    h.release(30); // tap before holdStart fired; tapWait
    h.advanceTo(331); // tap window expires → idle
    h.press(400); // new press
    h.advanceTo(475);
    // exactly one startRecording, from the new press
    expect(h.log.filter((t) => t === "startRecording").length).toBe(1);
  });

  it("forceReset (combo/panel stop) returns the machine to idle", () => {
    const m = createFnActivationMachine();
    m.press(0);
    m.fire(TIMER_HOLD_START, 75, 1);
    expect(m.isRecording()).toBe(true);
    m.forceReset(500);
    expect(m.getState()).toBe("idle");
    expect(m.isRecording()).toBe(false);
    // release after reset is a no-op
    expect(m.release(520)).toEqual([]);
  });

  it("a latch stop is immune to the expired tap-decision timer", () => {
    const m = createFnActivationMachine();
    m.press(0);
    m.fire(TIMER_HOLD_START, 75, 1);
    m.release(150);
    m.press(200); // latched (tapSeq bumped)
    // the tapDecision timer armed at release(150) fires late:
    expect(m.fire(TIMER_TAP_DECISION, 451, 1)).toEqual([]);
    expect(m.getState()).toBe("latched");
  });
});
