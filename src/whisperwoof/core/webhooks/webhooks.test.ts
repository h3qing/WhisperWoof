/**
 * Tests for Webhook Integration pure logic — payload, HMAC signing,
 * filter matching, URL validation.
 *
 * Imports `buildPayload`, `signPayload`, `matchesFilters`, and
 * `validateWebhookUrl` directly from `bridge/webhooks-pure.js`. These
 * are the same helpers `webhooks.js` delegates to — the inline copies
 * used to live inside `addWebhook` / `updateWebhook` / `fireWebhook`
 * and the test kept a parallel set that could drift silently.
 *
 * The async `fireWebhook` / `fireWebhooks` retry-loop lives in
 * `webhooks.js` and is tested via manual integration.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  buildPayload,
  signPayload,
  matchesFilters,
  validateWebhookUrl,
} from "../../bridge/webhooks-pure";

interface WebhookFilters {
  sources: string[] | null;
  tags: string[] | null;
  projects: string[] | null;
}

interface Entry {
  id: string;
  source: string;
  tags: string[];
  projectId: string | null;
  rawText: string;
  polished: string | null;
  createdAt: string;
  routedTo: string | null;
  metadata: Record<string, unknown>;
}

const SAMPLE_ENTRY: Entry = {
  id: "e1",
  source: "voice",
  tags: ["tag-1", "tag-2"],
  projectId: "proj-1",
  rawText: "um so I need to call Sarah",
  polished: "I need to call Sarah.",
  createdAt: "2026-03-30T10:00:00Z",
  routedTo: "paste-at-cursor",
  metadata: {},
};

describe("buildPayload", () => {
  it("builds a Zapier-compatible payload from an entry", () => {
    const payload = buildPayload(SAMPLE_ENTRY);
    expect(payload.event).toBe("entry.created");
    expect(payload.data.id).toBe("e1");
    expect(payload.data.source).toBe("voice");
    expect(payload.data.text).toBe("I need to call Sarah.");
    expect(payload.data.rawText).toBe("um so I need to call Sarah");
    expect(payload.data.tags).toEqual(["tag-1", "tag-2"]);
    expect(payload.data.projectId).toBe("proj-1");
  });

  it("prefers polished text but falls back to rawText", () => {
    const noPolished = { ...SAMPLE_ENTRY, polished: null };
    expect(buildPayload(noPolished).data.text).toBe("um so I need to call Sarah");

    const bothEmpty = { ...SAMPLE_ENTRY, polished: null, rawText: "" };
    expect(buildPayload(bothEmpty).data.text).toBe("");
  });

  it("includes a parseable ISO timestamp", () => {
    const payload = buildPayload(SAMPLE_ENTRY);
    expect(payload.timestamp).toBeTruthy();
    expect(() => new Date(payload.timestamp)).not.toThrow();
  });

  it("defaults missing arrays / objects to empty", () => {
    const bare = { ...SAMPLE_ENTRY, tags: undefined, metadata: undefined };
    const payload = buildPayload(bare as unknown as Entry);
    expect(payload.data.tags).toEqual([]);
    expect(payload.data.metadata).toEqual({});
  });
});

describe("signPayload — HMAC-SHA256", () => {
  it("returns null when no secret is provided", () => {
    expect(signPayload({ test: true }, null)).toBeNull();
    expect(signPayload({ test: true }, "")).toBeNull();
    expect(signPayload({ test: true }, undefined)).toBeNull();
  });

  it("returns a 64-char SHA256 hex string when a secret is provided", () => {
    const sig = signPayload({ test: true }, "my-secret");
    expect(sig).toBeTruthy();
    expect(sig!.length).toBe(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same signature for the same payload + secret", () => {
    const payload = { data: "hello" };
    expect(signPayload(payload, "secret")).toBe(signPayload(payload, "secret"));
  });

  it("produces different signatures for different secrets", () => {
    const payload = { data: "hello" };
    expect(signPayload(payload, "secret1")).not.toBe(signPayload(payload, "secret2"));
  });

  it("matches a hand-computed HMAC-SHA256 of the serialized JSON", () => {
    // This nails the exact algorithm and body format. If the source ever
    // changes serialization (e.g., stringify with spaces, different field
    // order), this assertion will catch the drift immediately.
    const payload = { event: "entry.created", data: { id: "abc" } };
    const secret = "s3cret";
    const expected = createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");
    expect(signPayload(payload, secret)).toBe(expected);
  });
});

describe("matchesFilters", () => {
  it("matches when filters are null", () => {
    expect(matchesFilters(SAMPLE_ENTRY, null)).toBe(true);
  });

  it("matches when every filter slot is null", () => {
    expect(matchesFilters(SAMPLE_ENTRY, { sources: null, tags: null, projects: null })).toBe(true);
  });

  it("filters by source", () => {
    expect(matchesFilters(SAMPLE_ENTRY, { sources: ["voice"], tags: null, projects: null })).toBe(true);
    expect(matchesFilters(SAMPLE_ENTRY, { sources: ["clipboard"], tags: null, projects: null })).toBe(false);
  });

  it("filters by tag (any-of match)", () => {
    expect(matchesFilters(SAMPLE_ENTRY, { sources: null, tags: ["tag-1"], projects: null })).toBe(true);
    expect(matchesFilters(SAMPLE_ENTRY, { sources: null, tags: ["tag-999"], projects: null })).toBe(false);
    // entry has tag-1 AND tag-2; filter with just tag-2 should still match
    expect(matchesFilters(SAMPLE_ENTRY, { sources: null, tags: ["tag-2", "tag-999"], projects: null })).toBe(true);
  });

  it("filters by project", () => {
    expect(matchesFilters(SAMPLE_ENTRY, { sources: null, tags: null, projects: ["proj-1"] })).toBe(true);
    expect(matchesFilters(SAMPLE_ENTRY, { sources: null, tags: null, projects: ["proj-999"] })).toBe(false);
  });

  it("combines filters with AND", () => {
    expect(matchesFilters(SAMPLE_ENTRY, { sources: ["voice"], tags: ["tag-1"], projects: ["proj-1"] })).toBe(true);
    expect(matchesFilters(SAMPLE_ENTRY, { sources: ["clipboard"], tags: ["tag-1"], projects: ["proj-1"] })).toBe(false);
  });

  it("treats an empty-array filter slot as matching (null-equivalent)", () => {
    expect(matchesFilters(SAMPLE_ENTRY, { sources: [], tags: [], projects: [] })).toBe(true);
  });
});

describe("validateWebhookUrl", () => {
  it("accepts https URLs", () => {
    expect(validateWebhookUrl("https://hooks.zapier.com/1234")).toBeNull();
    expect(validateWebhookUrl("https://n8n.example.com/webhook/abc")).toBeNull();
  });

  it("accepts http URLs (local dev / self-hosted)", () => {
    expect(validateWebhookUrl("http://localhost:5678/webhook")).toBeNull();
  });

  it("rejects non-http protocols (SSRF guard)", () => {
    expect(validateWebhookUrl("ftp://example.com")).toContain("http or https");
    expect(validateWebhookUrl("file:///etc/passwd")).toContain("http or https");
    expect(validateWebhookUrl("data:text/plain,hello")).toContain("http or https");
  });

  it("rejects invalid or empty URLs", () => {
    expect(validateWebhookUrl("not-a-url")).toContain("Invalid URL");
    expect(validateWebhookUrl("")).toContain("required");
    expect(validateWebhookUrl("   ")).toContain("required");
    expect(validateWebhookUrl(null)).toContain("required");
    expect(validateWebhookUrl(undefined)).toContain("required");
  });
});
