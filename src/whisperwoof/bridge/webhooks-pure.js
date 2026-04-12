/**
 * Pure logic for Webhook Integration.
 *
 * No file I/O, no electron. Shared between webhooks.js (which layers on
 * persistence + the HTTP fire loop) and webhooks.test.ts.
 *
 * These are the security-relevant gates: HMAC signing, URL validation,
 * payload shape, filter matching. Both production and tests MUST import
 * from here so any drift trips the test suite immediately.
 */

const crypto = require("crypto");

/**
 * Build the JSON payload sent to a webhook endpoint. Zapier / n8n /
 * Make compatible shape.
 */
function buildPayload(entry) {
  return {
    event: "entry.created",
    timestamp: new Date().toISOString(),
    data: {
      id: entry.id,
      createdAt: entry.createdAt,
      source: entry.source,
      text: entry.polished || entry.rawText || "",
      rawText: entry.rawText || null,
      routedTo: entry.routedTo || null,
      projectId: entry.projectId || null,
      tags: entry.tags || [],
      metadata: entry.metadata || {},
    },
  };
}

/**
 * Sign a payload with HMAC-SHA256 so the receiver can verify the webhook
 * came from WhisperWoof and wasn't tampered with. Returns null if no
 * secret was configured (signing is optional).
 */
function signPayload(payload, secret) {
  if (!secret) return null;
  const body = JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Check if an entry matches a webhook's filters. Filters are ANDed —
 * every active filter clause must match for the entry to qualify.
 * A null filter block matches everything.
 */
function matchesFilters(entry, filters) {
  if (!filters) return true;

  if (filters.sources && filters.sources.length > 0) {
    if (!filters.sources.includes(entry.source)) return false;
  }

  if (filters.tags && filters.tags.length > 0) {
    const entryTags = entry.tags || [];
    if (!filters.tags.some((t) => entryTags.includes(t))) return false;
  }

  if (filters.projects && filters.projects.length > 0) {
    if (!filters.projects.includes(entry.projectId)) return false;
  }

  return true;
}

/**
 * Validate a webhook target URL. Returns null if valid, or a
 * human-readable error string. Only http/https are allowed — no file://,
 * ftp://, data:, etc. (would otherwise be a locally-exploitable SSRF
 * vector from a malicious settings import).
 */
function validateWebhookUrl(url) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return "URL is required";
  }
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "URL must use http or https";
    }
    return null;
  } catch {
    return "Invalid URL format";
  }
}

module.exports = {
  buildPayload,
  signPayload,
  matchesFilters,
  validateWebhookUrl,
};
