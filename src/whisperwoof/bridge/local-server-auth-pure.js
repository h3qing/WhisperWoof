/**
 * Per-process secrets for the loopback model servers.
 *
 * whisper-server and llama-server listen on 127.0.0.1 with permissive CORS,
 * so any web page in the user's browser (or a DNS-rebinding page) can reach
 * them. Each launch gets a fresh secret:
 *
 * - llama-server: an API key, handed over in the LLAMA_API_KEY environment
 *   variable (never argv, which other local users can read with `ps`), sent
 *   as `Authorization: Bearer <key>`. /health stays public upstream.
 * - whisper-server (OpenWhispr/whisper.cpp) has no auth, but registers every
 *   route (/, /inference, /load, /health) under `--request-path`; a random
 *   prefix makes the URLs unguessable (a capability URL).
 */
const crypto = require("crypto");

const REQUEST_PATH_RE = /^\/ww-[0-9a-f]{32}$/;
const API_KEY_RE = /^[0-9a-f]{64}$/;

function newServerApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

// Only [a-z0-9-]: whisper-server hands the route string to cpp-httplib, which
// compiles it as a regular expression.
function newServerRequestPath() {
  return `/ww-${crypto.randomBytes(16).toString("hex")}`;
}

function isServerApiKey(key) {
  return typeof key === "string" && API_KEY_RE.test(key);
}

function isServerRequestPath(p) {
  return typeof p === "string" && REQUEST_PATH_RE.test(p);
}

function bearerHeaders(apiKey) {
  return isServerApiKey(apiKey) ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** Copy of argv safe to log: every secret value replaced. */
function redactArgs(args, secrets) {
  const hidden = (secrets || []).filter((s) => typeof s === "string" && s.length > 0);
  return (args || []).map((arg) => {
    let out = String(arg);
    for (const s of hidden) out = out.split(s).join("<redacted>");
    return out;
  });
}

module.exports = {
  newServerApiKey,
  newServerRequestPath,
  isServerApiKey,
  isServerRequestPath,
  bearerHeaders,
  redactArgs,
};
