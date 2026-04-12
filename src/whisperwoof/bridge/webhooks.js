/**
 * Webhook Integration — Send entries to external services
 *
 * Zapier/n8n/Make compatible HTTP webhooks. When an entry is created,
 * matching webhooks fire with a JSON payload.
 *
 * Features:
 * - CRUD for webhook endpoints
 * - Filter by source (voice/clipboard/meeting/import), tag, or project
 * - Retry with exponential backoff on failure
 * - Delivery log for debugging
 * - Secret-based HMAC signing for security
 * - Test fire (send a sample payload)
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-webhooks.json
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  buildPayload,
  signPayload,
  matchesFilters,
  validateWebhookUrl,
} = require("./webhooks-pure");

const WEBHOOKS_FILE = path.join(app.getPath("userData"), "whisperwoof-webhooks.json");
const MAX_WEBHOOKS = 20;
const MAX_RETRIES = 3;
const DELIVERY_LOG_MAX = 200;

// --- Storage ---

function loadWebhooks() {
  try {
    if (fs.existsSync(WEBHOOKS_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOKS_FILE, "utf-8"));
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load webhooks", { error: err.message });
  }
  return { webhooks: [], deliveryLog: [] };
}

function saveWebhooks(data) {
  try {
    const dir = path.dirname(WEBHOOKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save webhooks", { error: err.message });
  }
}

// --- CRUD ---

function getWebhooks() {
  return loadWebhooks().webhooks;
}

function addWebhook(config) {
  const urlError = validateWebhookUrl(config.url);
  if (urlError) return { success: false, error: urlError };

  const url = config.url.trim();
  const data = loadWebhooks();
  if (data.webhooks.length >= MAX_WEBHOOKS) {
    return { success: false, error: `Maximum ${MAX_WEBHOOKS} webhooks reached` };
  }

  const webhook = {
    id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    name: (config.name || "").trim() || url.split("/").pop() || "Webhook",
    enabled: config.enabled !== false,
    secret: config.secret || null,
    filters: {
      sources: config.sources || null,     // null = all, or ["voice", "clipboard"]
      tags: config.tags || null,           // null = all, or ["tag-id-1"]
      projects: config.projects || null,   // null = all, or ["project-id-1"]
    },
    createdAt: new Date().toISOString(),
    lastFiredAt: null,
    fireCount: 0,
    failCount: 0,
  };

  data.webhooks.push(webhook);
  saveWebhooks(data);

  debugLogger.info("[WhisperWoof] Webhook added", { id: webhook.id, url: webhook.url });
  return { success: true, webhook };
}

function updateWebhook(id, updates) {
  const data = loadWebhooks();
  const idx = data.webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return { success: false, error: "Webhook not found" };

  const allowed = {};
  if (updates.name !== undefined) allowed.name = updates.name.trim();
  if (updates.url !== undefined) {
    const urlError = validateWebhookUrl(updates.url);
    if (urlError) return { success: false, error: urlError };
    allowed.url = updates.url.trim();
  }
  if (updates.enabled !== undefined) allowed.enabled = !!updates.enabled;
  if (updates.secret !== undefined) allowed.secret = updates.secret || null;
  if (updates.filters !== undefined) allowed.filters = updates.filters;

  data.webhooks[idx] = { ...data.webhooks[idx], ...allowed };
  saveWebhooks(data);

  return { success: true };
}

function removeWebhook(id) {
  const data = loadWebhooks();
  const filtered = data.webhooks.filter((w) => w.id !== id);
  if (filtered.length === data.webhooks.length) {
    return { success: false, error: "Webhook not found" };
  }
  data.webhooks = filtered;
  saveWebhooks(data);
  return { success: true };
}

// Pure payload / signing / filter / URL-validation helpers are required
// at the top of this file from ./webhooks-pure.

// --- Fire webhooks ---

/**
 * Fire all matching webhooks for an entry.
 */
async function fireWebhooks(entry) {
  const data = loadWebhooks();
  const enabledWebhooks = data.webhooks.filter((w) => w.enabled);

  if (enabledWebhooks.length === 0) return { fired: 0, failed: 0 };

  const payload = buildPayload(entry);
  let fired = 0;
  let failed = 0;

  for (const webhook of enabledWebhooks) {
    if (!matchesFilters(entry, webhook.filters)) continue;

    const result = await fireWebhook(webhook, payload);

    // Update webhook stats
    const idx = data.webhooks.findIndex((w) => w.id === webhook.id);
    if (idx !== -1) {
      data.webhooks[idx].lastFiredAt = new Date().toISOString();
      data.webhooks[idx].fireCount = (data.webhooks[idx].fireCount || 0) + 1;
      if (!result.success) {
        data.webhooks[idx].failCount = (data.webhooks[idx].failCount || 0) + 1;
      }
    }

    // Add to delivery log
    data.deliveryLog.push({
      webhookId: webhook.id,
      webhookName: webhook.name,
      entryId: entry.id,
      timestamp: new Date().toISOString(),
      success: result.success,
      statusCode: result.statusCode || null,
      error: result.error || null,
      durationMs: result.durationMs || 0,
    });

    if (result.success) fired++;
    else failed++;
  }

  // Prune delivery log
  if (data.deliveryLog.length > DELIVERY_LOG_MAX) {
    data.deliveryLog = data.deliveryLog.slice(-DELIVERY_LOG_MAX);
  }

  saveWebhooks(data);

  debugLogger.info("[WhisperWoof] Webhooks fired", { fired, failed, total: enabledWebhooks.length });
  return { fired, failed };
}

/**
 * Fire a single webhook with retry.
 */
async function fireWebhook(webhook, payload) {
  const body = JSON.stringify(payload);
  const signature = signPayload(payload, webhook.secret);

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "WhisperWoof/1.2.0",
  };

  if (signature) {
    headers["X-WhisperWoof-Signature"] = `sha256=${signature}`;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (response.ok) {
        return { success: true, statusCode: response.status, durationMs };
      }

      // Don't retry on 4xx (client error)
      if (response.status >= 400 && response.status < 500) {
        return { success: false, statusCode: response.status, durationMs, error: `HTTP ${response.status}` };
      }

      // Retry on 5xx
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }

      return { success: false, statusCode: response.status, durationMs, error: `HTTP ${response.status} after ${attempt + 1} attempts` };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (attempt < MAX_RETRIES && err.name !== "AbortError") {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      return { success: false, durationMs, error: err.name === "AbortError" ? "Timeout" : err.message };
    }
  }

  return { success: false, error: "Max retries exceeded" };
}

/**
 * Send a test payload to a webhook.
 */
async function testWebhook(webhookId) {
  const data = loadWebhooks();
  const webhook = data.webhooks.find((w) => w.id === webhookId);
  if (!webhook) return { success: false, error: "Webhook not found" };

  const testPayload = buildPayload({
    id: "test-entry",
    createdAt: new Date().toISOString(),
    source: "voice",
    rawText: "This is a test entry from WhisperWoof",
    polished: "This is a test entry from WhisperWoof.",
    routedTo: "paste-at-cursor",
    projectId: null,
    tags: [],
    metadata: { test: true },
  });

  return await fireWebhook(webhook, testPayload);
}

/**
 * Get delivery log for debugging.
 */
function getDeliveryLog(limit = 50) {
  return loadWebhooks().deliveryLog.slice(-limit);
}

module.exports = {
  getWebhooks,
  addWebhook,
  updateWebhook,
  removeWebhook,
  fireWebhooks,
  testWebhook,
  getDeliveryLog,
  buildPayload,
  signPayload,
  matchesFilters,
};
