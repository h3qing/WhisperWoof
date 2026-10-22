/**
 * The local model's queue (bridge/reasoning-queue-pure.js) and the gate for
 * background work (bridge/background-gate-pure.js). llama-server answers one
 * request at a time, so dictation's cleanup (interactive) goes first, and a
 * background call already running is aborted and goes back to the head of
 * the background line.
 */
import { createRequire } from "module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const queue = require("../../bridge/reasoning-queue-pure");
const gate = require("../../bridge/background-gate-pure");

const bg = (id: string) => ({ id, kind: "background" });
const ia = (id: string) => ({ id, kind: "interactive" });
const ids = (state: { waiting: Array<{ id: string }> }) => state.waiting.map((j) => j.id);

describe("reasoning queue", () => {
  it("starts empty", () => {
    const state = queue.createQueue();
    expect(state.waiting).toEqual([]);
    expect(state.running).toBeNull();
  });

  it("runs interactive work before background work", () => {
    let state = queue.createQueue();
    state = queue.enqueue(state, bg("b1")).state;
    state = queue.enqueue(state, bg("b2")).state;
    state = queue.enqueue(state, ia("i1")).state;
    state = queue.enqueue(state, ia("i2")).state;
    expect(ids(state)).toEqual(["i1", "i2", "b1", "b2"]);
    const next = queue.takeNext(state, { backgroundAllowed: true });
    expect(next.job.id).toBe("i1");
    expect(next.state.running.id).toBe("i1");
  });

  it("aborts the running background call for an interactive one and requeues it first in line", () => {
    let state = queue.createQueue();
    state = queue.enqueue(state, bg("b1")).state;
    state = queue.enqueue(state, bg("b2")).state;
    state = queue.takeNext(state, { backgroundAllowed: true }).state; // b1 runs
    const { state: after, preempt } = queue.enqueue(state, ia("i1"));
    expect(preempt?.id).toBe("b1");
    expect(after.running).toBeNull();
    expect(ids(after)).toEqual(["i1", "b1", "b2"]);
  });

  it("never preempts interactive work, and background work doesn't preempt anything", () => {
    let state = queue.enqueue(queue.createQueue(), ia("i1")).state;
    state = queue.takeNext(state, { backgroundAllowed: true }).state; // i1 runs
    const second = queue.enqueue(state, ia("i2"));
    expect(second.preempt).toBeNull();
    expect(second.state.running.id).toBe("i1");
    const third = queue.enqueue(second.state, bg("b1"));
    expect(third.preempt).toBeNull();
    expect(ids(third.state)).toEqual(["i2", "b1"]);
  });

  it("holds background work while the gate is closed, and starts nothing while something runs", () => {
    let state = queue.enqueue(queue.createQueue(), bg("b1")).state;
    expect(queue.takeNext(state, { backgroundAllowed: false }).job).toBeNull();
    state = queue.takeNext(state, { backgroundAllowed: true }).state;
    state = queue.enqueue(state, bg("b2")).state;
    expect(queue.takeNext(state, { backgroundAllowed: true }).job).toBeNull();
  });

  it("finishes only the job that is running", () => {
    let state = queue.enqueue(queue.createQueue(), bg("b1")).state;
    state = queue.takeNext(state, { backgroundAllowed: true }).state;
    expect(queue.finish(state, "other").running.id).toBe("b1");
    expect(queue.finish(state, "b1").running).toBeNull();
  });

  it("removes a waiting job", () => {
    let state = queue.enqueue(queue.createQueue(), bg("b1")).state;
    state = queue.enqueue(state, bg("b2")).state;
    expect(ids(queue.remove(state, "b1"))).toEqual(["b2"]);
    expect(ids(queue.remove(state, "nope"))).toEqual(["b1", "b2"]);
  });

  it("never changes the state it was given", () => {
    const start = queue.enqueue(queue.createQueue(), bg("b1")).state;
    const snapshot = JSON.stringify(start);
    queue.enqueue(start, ia("i1"));
    queue.takeNext(start, { backgroundAllowed: true });
    queue.remove(start, "b1");
    expect(JSON.stringify(start)).toBe(snapshot);
    expect(Object.isFrozen(start)).toBe(true);
    expect(Object.isFrozen(start.waiting)).toBe(true);
  });

  it("rejects jobs without an id or a known kind", () => {
    expect(() => queue.enqueue(queue.createQueue(), { id: "", kind: "background" })).toThrow();
    expect(() => queue.enqueue(queue.createQueue(), { id: "x", kind: "later" })).toThrow();
  });

  it("caps background answers: map pieces at 512 tokens, the reduce at 1024", () => {
    expect(queue.capBackgroundTokens(undefined, "map")).toBe(512);
    expect(queue.capBackgroundTokens(4000, "map")).toBe(512);
    expect(queue.capBackgroundTokens(200, "map")).toBe(200);
    expect(queue.capBackgroundTokens(4000, "reduce")).toBe(1024);
    expect(queue.capBackgroundTokens(undefined, "reduce")).toBe(1024);
    expect(queue.capBackgroundTokens(-5, "anything")).toBe(512);
  });
});

describe("background gate", () => {
  const T = 1_000_000;

  it("waits until the last interactive request is 10 s old", () => {
    expect(gate.BACKGROUND_IDLE_MS).toBe(10_000);
    expect(gate.backgroundDelayMs({ now: T, lastInteractiveAt: T - 3_000 })).toBe(7_000);
    expect(gate.backgroundAllowed({ now: T, lastInteractiveAt: T - 9_999 })).toBe(false);
    expect(gate.backgroundAllowed({ now: T, lastInteractiveAt: T - 10_000 })).toBe(true);
  });

  it("is open when nothing interactive ever ran", () => {
    expect(gate.backgroundDelayMs({ now: T, lastInteractiveAt: null })).toBe(0);
    expect(gate.backgroundAllowed({ now: T })).toBe(true);
  });

  it("stays closed while interactive work runs or the app is busy (a meeting transcribing)", () => {
    expect(gate.backgroundAllowed({ now: T, interactiveRunning: true })).toBe(false);
    expect(gate.backgroundAllowed({ now: T, busy: true })).toBe(false);
    expect(gate.backgroundDelayMs({ now: T, busy: true })).toBeGreaterThan(0);
  });

  it("takes a shorter idle time when asked (tests, tuning)", () => {
    expect(gate.backgroundDelayMs({ now: T, lastInteractiveAt: T - 10, idleMs: 50 })).toBe(40);
  });
});
