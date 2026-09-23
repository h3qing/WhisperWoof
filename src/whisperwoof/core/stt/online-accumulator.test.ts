/**
 * The online (streaming) sherpa server sends `{text, segment, is_final}`
 * messages. Live dictation needs the committed part (segments the endpoint
 * detector finalized) separately from the provisional tail so the panel can
 * underline only what may still change — and CJK segments must join without
 * the ASCII space that English segments need.
 */
import { describe, it, expect } from "vitest";
import {
  createOnlineAccumulator,
  joinTranscriptSegments,
} from "../../../helpers/parakeetWsResult.js";

const msg = (text: string, segment: number, isFinal = false) =>
  JSON.stringify({ text, segment, is_final: isFinal });

describe("joinTranscriptSegments", () => {
  it("joins English segments with a space", () => {
    expect(joinTranscriptSegments(["Hello there.", "How are you"])).toBe(
      "Hello there. How are you"
    );
  });

  it("joins Chinese segments without a space", () => {
    expect(joinTranscriptSegments(["今天下午三点开会，", "讨论一下"])).toBe(
      "今天下午三点开会，讨论一下"
    );
  });

  it("does not insert a space when either side of the seam is CJK", () => {
    expect(joinTranscriptSegments(["讨论一下", "Q3 roadmap"])).toBe("讨论一下Q3 roadmap");
    expect(joinTranscriptSegments(["the roadmap", "我们明天说"])).toBe("the roadmap我们明天说");
  });

  it("skips empty segments", () => {
    expect(joinTranscriptSegments(["", "hi", "  ", "there"])).toBe("hi there");
  });
});

describe("createOnlineAccumulator parts()", () => {
  it("reports a non-final message as provisional", () => {
    const acc = createOnlineAccumulator();
    acc.push(msg("今天下午", 0));
    expect(acc.parts()).toEqual({ committed: "", partial: "今天下午" });
    expect(acc.text()).toBe("今天下午");
  });

  it("moves a finalized segment into committed and keeps the next partial separate", () => {
    const acc = createOnlineAccumulator();
    acc.push(msg("今天下午三点开会", 0));
    acc.push(msg("今天下午三点开会，", 0, true));
    acc.push(msg("讨论以下", 1));
    expect(acc.parts()).toEqual({ committed: "今天下午三点开会，", partial: "讨论以下" });
    expect(acc.text()).toBe("今天下午三点开会，讨论以下");
  });

  it("keeps English spacing between committed and partial", () => {
    const acc = createOnlineAccumulator();
    acc.push(msg("Ship it.", 0, true));
    acc.push(msg("Then iterate", 1));
    expect(acc.text()).toBe("Ship it. Then iterate");
  });

  it("returns a fresh object each call (callers may hold on to it)", () => {
    const acc = createOnlineAccumulator();
    acc.push(msg("a", 0));
    const first = acc.parts();
    acc.push(msg("a b", 0));
    expect(first).toEqual({ committed: "", partial: "a" });
  });
});

describe("spelled-out acronyms from the streaming tokenizer", () => {
  it("joins single capital letters the model emits one token at a time", () => {
    const acc = createOnlineAccumulator();
    acc.push(msg("是不是我的 V P N 有什么特别的", 0));
    expect(acc.text()).toBe("是不是我的 VPN 有什么特别的");
  });

  it("leaves ordinary words and a lone capital alone", () => {
    const acc = createOnlineAccumulator();
    acc.push(msg("I think A is fine, check the API", 0));
    expect(acc.text()).toBe("I think A is fine, check the API");
  });
});
