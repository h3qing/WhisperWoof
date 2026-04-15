/**
 * Daily Digest — pure logic (no electron/fs/app/debugLogger)
 *
 * Extracted from daily-digest.js so tests can import without
 * triggering Electron side effects at load time.
 */

const DIGEST_PROMPT =
  "You are a personal assistant summarizing a user's voice notes and captured text from today.\n\n" +
  "Rules:\n" +
  "- Create a structured daily digest with these sections:\n" +
  "  ## Key Topics — the main things discussed/captured (3-7 bullet points)\n" +
  "  ## Action Items — anything that sounds like a task or to-do\n" +
  "  ## Decisions — any decisions that were made or stated\n" +
  "  ## Notes — other notable items that don't fit above\n" +
  "- Be concise — one sentence per bullet point\n" +
  "- If a section has no items, omit it entirely\n" +
  "- Use Markdown formatting\n" +
  "- Preserve names, dates, numbers, and specifics\n" +
  "- Return ONLY the digest, no introductions or conclusions";

function buildDigestData(entries) {
  if (entries.length === 0) {
    return {
      entryCount: 0,
      wordCount: 0,
      sources: {},
      entries: [],
      timeRange: null,
    };
  }

  const sources = {};
  let totalWords = 0;

  for (const entry of entries) {
    const src = entry.source || "unknown";
    sources[src] = (sources[src] || 0) + 1;
    totalWords += (entry.text || "").split(/\s+/).filter(Boolean).length;
  }

  return {
    entryCount: entries.length,
    wordCount: totalWords,
    sources,
    timeRange: {
      start: entries[0].createdAt,
      end: entries[entries.length - 1].createdAt,
    },
    entries: entries.map((e) => ({
      id: e.id,
      source: e.source,
      text: e.text.slice(0, 500),
      routedTo: e.routedTo,
      createdAt: e.createdAt,
    })),
  };
}

module.exports = {
  buildDigestData,
  DIGEST_PROMPT,
};
