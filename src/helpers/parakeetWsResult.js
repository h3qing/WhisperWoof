function parseOfflineMessage(message) {
  const text = String(message || "").trim();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.text === "string" ? parsed.text.trim() : text;
  } catch {
    return text;
  }
}

// CJK characters and full-width punctuation: a seam touching one of these
// joins without a space (Chinese never spaces between clauses).
const CJK_EDGE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

// The streaming zipformer's tokenizer spells acronyms letter by letter
// ("V P N"); rejoin runs of 2+ single capitals separated by single spaces.
const SPELLED_ACRONYM = /\b[A-Z](?: [A-Z]\b)+/g;

function joinSpelledAcronyms(text) {
  return text.replace(SPELLED_ACRONYM, (run) => run.replace(/ /g, ""));
}

function joinTranscriptSegments(segments) {
  return segments
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .reduce((joined, segment) => {
      if (!joined) return segment;
      const cjkSeam = CJK_EDGE.test(joined.slice(-1)) || CJK_EDGE.test(segment[0]);
      return cjkSeam ? joined + segment : `${joined} ${segment}`;
    }, "");
}

// Latest-wins per finalized segment id (the server refines a segment before its
// endpoint); text() joins segments in first-arrival order plus the trailing partial.
// parts() splits the same text into what the endpoint detector committed and the
// provisional tail that may still be rewritten — live dictation underlines the latter.
function createOnlineAccumulator() {
  const finalizedSegments = new Map();
  let partialText = "";
  let partialSegment = null;
  let fallbackKey = 0;

  const parts = () => ({
    committed: joinTranscriptSegments(Array.from(finalizedSegments.values())),
    partial: partialText,
  });

  const text = () => {
    const { committed, partial } = parts();
    return joinTranscriptSegments([committed, partial]);
  };

  return {
    push(message) {
      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        parsed = { text: message };
      }
      if (!parsed || typeof parsed !== "object") return text();

      const messageText = joinSpelledAcronyms(String(parsed.text ?? "").trim());
      if (!messageText) return text();

      if (!parsed.is_final) {
        partialText = finalizedSegments.has(parsed.segment) ? "" : messageText;
        partialSegment = parsed.segment ?? null;
        return text();
      }

      const segment = parsed.segment ?? `fallback:${fallbackKey++}`;
      finalizedSegments.set(segment, messageText);
      if (partialSegment === null || partialSegment === segment) {
        partialText = "";
        partialSegment = null;
      }
      return text();
    },
    text,
    parts,
  };
}

function parseOnlineMessages(messages) {
  const accumulator = createOnlineAccumulator();
  for (const message of messages) {
    accumulator.push(message);
  }
  return accumulator.text();
}

module.exports = {
  parseOfflineMessage,
  parseOnlineMessages,
  createOnlineAccumulator,
  joinTranscriptSegments,
};
