/**
 * Debug log lines written while encryption is on: strings under keys that
 * carry what the user said, typed or wrote become "[N chars]". Numbers,
 * flags, ids, paths and error messages stay, so logs are still useful.
 * Pure; returns new objects.
 */

const CONTENT_KEY = /text|preview|prompt|transcript|response|body|content|field|word|goal|polished|raw|segment|summary|query|title|phrase|clipboard/i;

function redactValue(value, seen) {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object" ? redactObject(item, seen) : item));
  }
  if (value && typeof value === "object") return redactObject(value, seen);
  return value;
}

function redactObject(obj, seen) {
  if (seen.has(obj)) return "[cycle]";
  seen.add(obj);
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (CONTENT_KEY.test(key)) {
        if (typeof value === "string") return [key, `[${value.length} chars]`];
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) return [key, `[${value.length} items]`];
      }
      return [key, redactValue(value, seen)];
    })
  );
}

function redactContent(meta) {
  if (!meta || typeof meta !== "object") return meta;
  return redactValue(meta, new WeakSet());
}

module.exports = { redactContent };
