/**
 * Debug log lines written while encryption is on: strings under keys that
 * carry what the user said, typed or wrote become "[N chars]". Numbers,
 * flags, ids, paths and error messages stay, so logs are still useful.
 * Pure; returns new objects.
 */

const CONTENT_KEY =
  /text|preview|prompt|transcript|response|body|content|field|word|goal|polished|raw|segment|summary|query|title|phrase|clipboard|data|args|correction|offer|value|stdout|stderr|original|alternative|swap/i;

// Everything under a content key is content too: `corrections: [{ from, to }]`.
function redactValue(value, seen, isContent) {
  if (typeof value === "string") return isContent ? `[${value.length} chars]` : value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, isContent));
  if (value && typeof value === "object") return redactObject(value, seen, isContent);
  return value;
}

function redactObject(obj, seen, isContent) {
  if (seen.has(obj)) return "[cycle]";
  seen.add(obj);
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      const content = isContent || CONTENT_KEY.test(key);
      if (content && Array.isArray(value) && value.every((v) => typeof v === "string")) {
        return [key, `[${value.length} items]`];
      }
      return [key, redactValue(value, seen, content)];
    })
  );
}

function redactContent(meta) {
  if (!meta || typeof meta !== "object") return meta;
  return redactValue(meta, new WeakSet(), false);
}

module.exports = { redactContent };
