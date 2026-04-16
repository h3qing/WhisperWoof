#!/usr/bin/env node
/**
 * bench-latency.js — Startup latency eval for WhisperWoof.
 *
 * Reads bf_entries from the local SQLite database, extracts
 * metadata.timings, and produces a report focused on the
 * "hit button → ready to receive talking" (startupMs) metric.
 *
 * Usage:
 *   npx electron --no-sandbox scripts/bench-latency.js   # via Electron's Node
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/bench-latency.js
 *   npm run bench:latency                                 # package.json shortcut
 *
 * Flags:
 *   --all        all captures with timings (default: last 100)
 *   --last N     last N captures
 *   --json       machine-readable output
 */

const path = require("path");
const os = require("os");

// Resolve the database path. Electron sets the userData directory based on
// the productName + environment suffix. Try the known locations in order.
const fs = require("fs");

function getDbPath() {
  const platform = os.platform();
  // Candidate app names: dev build appends "-development"
  const appNames = ["WhisperWoof-development", "WhisperWoof", "whisperwoof"];
  const dbNames = ["transcriptions-dev.db", "transcriptions.db"];

  function baseDirs(appName) {
    if (platform === "darwin") return [path.join(os.homedir(), "Library", "Application Support", appName)];
    if (platform === "win32") return [path.join(process.env.APPDATA || "", appName)];
    return [path.join(os.homedir(), ".config", appName)];
  }

  for (const appName of appNames) {
    for (const dir of baseDirs(appName)) {
      for (const dbName of dbNames) {
        const candidate = path.join(dir, dbName);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  // Fallback: let the caller handle the error
  const fallback = path.join(os.homedir(), "Library", "Application Support", "WhisperWoof-development", "transcriptions-dev.db");
  return fallback;
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(values) {
  if (values.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p90: null, p95: null, p99: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const allCaptures = args.includes("--all");
  const lastIdx = args.indexOf("--last");
  const limit = allCaptures ? 999999 : lastIdx >= 0 ? parseInt(args[lastIdx + 1], 10) || 100 : 100;

  const dbPath = getDbPath();

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error(
      "better-sqlite3 not found. Run from the project root:\n  node scripts/bench-latency.js"
    );
    process.exit(1);
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error(`Cannot open database at ${dbPath}\n  ${err.message}`);
    process.exit(1);
  }

  const rows = db
    .prepare(
      `SELECT id, created_at, metadata FROM bf_entries
       WHERE metadata IS NOT NULL AND metadata != '{}'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit);

  db.close();

  // Parse timings from metadata JSON
  const entries = [];
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta?.timings) {
        entries.push({ id: row.id, createdAt: row.created_at, ...meta.timings });
      }
    } catch {
      // skip malformed JSON
    }
  }

  if (entries.length === 0) {
    console.log("No captures with timing data found.");
    process.exit(0);
  }

  // Collect values for each metric
  const startupVals = entries.map((e) => e.startupMs).filter((v) => v != null);
  const micAcquireVals = entries.map((e) => e.micAcquireMs).filter((v) => v != null);
  const perceivedVals = entries.map((e) => e.perceivedMs).filter((v) => v != null);
  const sttVals = entries.map((e) => e.sttMs).filter((v) => v != null);
  const polishVals = entries.map((e) => e.polishMs).filter((v) => v != null);
  const pasteVals = entries.map((e) => e.pasteMs).filter((v) => v != null);
  const totalVals = entries.map((e) => e.totalMs).filter((v) => v != null);

  // Pipeline setup time = startupMs - micAcquireMs (AudioWorklet + MediaRecorder init)
  const pipelineSetupVals = entries
    .filter((e) => e.startupMs != null && e.micAcquireMs != null)
    .map((e) => e.startupMs - e.micAcquireMs);

  // Classify cold vs warm starts (heuristic: micAcquireMs > 200 is "cold")
  const COLD_THRESHOLD_MS = 200;
  const coldStarts = micAcquireVals.filter((v) => v >= COLD_THRESHOLD_MS);
  const warmStarts = micAcquireVals.filter((v) => v < COLD_THRESHOLD_MS);

  const report = {
    totalCaptures: entries.length,
    withStartupData: startupVals.length,
    withMicAcquireData: micAcquireVals.length,
    startup: stats(startupVals),
    micAcquire: stats(micAcquireVals),
    pipelineSetup: stats(pipelineSetupVals),
    coldStarts: stats(coldStarts),
    warmStarts: stats(warmStarts),
    perceived: stats(perceivedVals),
    stt: stats(sttVals),
    polish: stats(polishVals),
    paste: stats(pasteVals),
    total: stats(totalVals),
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║        WhisperWoof Startup Latency Eval Report         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`  Captures analyzed: ${entries.length}`);
  console.log(`  With startup data: ${startupVals.length}`);
  console.log(`  With micAcquire data: ${micAcquireVals.length}`);
  console.log(`  Cold starts (≥${COLD_THRESHOLD_MS}ms): ${coldStarts.length}`);
  console.log(`  Warm starts (<${COLD_THRESHOLD_MS}ms): ${warmStarts.length}`);
  console.log();

  function printTable(label, s) {
    if (s.count === 0) {
      console.log(`  ${label}: no data`);
      return;
    }
    console.log(
      `  ${label.padEnd(22)} cnt=${String(s.count).padStart(4)}  ` +
        `min=${String(s.min).padStart(5)}  p50=${String(s.p50).padStart(5)}  ` +
        `p90=${String(s.p90).padStart(5)}  p95=${String(s.p95).padStart(5)}  ` +
        `p99=${String(s.p99).padStart(5)}  max=${String(s.max).padStart(5)}ms`
    );
  }

  console.log("  ── Button → Ready (startupMs) ──────────────────────────");
  printTable("startup (all)", report.startup);
  printTable("getUserMedia (all)", report.micAcquire);
  printTable("getUserMedia (cold)", report.coldStarts);
  printTable("getUserMedia (warm)", report.warmStarts);
  printTable("pipeline setup", report.pipelineSetup);
  console.log();

  console.log("  ── Full Pipeline ───────────────────────────────────────");
  printTable("perceived (stop→paste)", report.perceived);
  printTable("stt", report.stt);
  printTable("polish", report.polish);
  printTable("paste", report.paste);
  printTable("total (e2e)", report.total);
  console.log();

  // Flag slow captures
  const slowStartups = entries.filter((e) => e.startupMs != null && e.startupMs > 200);
  if (slowStartups.length > 0) {
    console.log(`  ⚠  ${slowStartups.length} captures with startup > 200ms:`);
    for (const e of slowStartups.slice(0, 5)) {
      console.log(
        `     ${e.createdAt}  startup=${e.startupMs}ms  micAcquire=${e.micAcquireMs ?? "?"}ms`
      );
    }
    if (slowStartups.length > 5) {
      console.log(`     ... and ${slowStartups.length - 5} more`);
    }
    console.log();
  }

  // Budget check
  const overBudget = entries.filter((e) => e.perceivedMs != null && e.perceivedMs > 500);
  if (overBudget.length > 0) {
    console.log(`  ⚠  ${overBudget.length} captures over 500ms perceived latency budget`);
  } else if (perceivedVals.length > 0) {
    console.log("  ✓  All captures within 500ms perceived latency budget");
  }
  console.log();
}

main();
