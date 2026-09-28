/**
 * Environment for native sidecars (whisper-server, llama-server, ffmpeg).
 *
 * Spawning with `{ ...process.env }` hands every child the user's cloud API
 * keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, ...), OAuth client secrets and any
 * GitHub token — none of which a local model server or ffmpeg needs. It also
 * forwards dynamic-loader injection variables, which would let a poisoned
 * environment load code into every sidecar. This copies the environment
 * without them; callers add what the child really needs afterwards.
 */

// Secret-shaped names: FOO_API_KEY, FOO_APIKEY, FOO_TOKEN, FOO_SECRET,
// FOO_SECRET_KEY, AWS_SECRET_ACCESS_KEY, FOO_PASSWORD. Case-insensitive
// because Windows environment names are.
const SECRET_NAME = /(?:^|_)(?:API_?KEY|SECRET(?:_ACCESS)?_KEY|SECRET|TOKEN|PASSWORD|PASSWD)$/i;

// Loader variables that inject code into a process. The *_LIBRARY_PATH
// variables are left alone: the app sets them itself so a sidecar finds the
// libraries shipped next to it.
const LOADER_INJECTION = new Set(["LD_PRELOAD", "LD_AUDIT", "DYLD_INSERT_LIBRARIES"]);

function isSecretEnvName(name) {
  return typeof name === "string" && SECRET_NAME.test(name);
}

function isStrippedEnvName(name) {
  if (typeof name !== "string") return true;
  return isSecretEnvName(name) || LOADER_INJECTION.has(name.toUpperCase());
}

/**
 * A copy of `baseEnv` without secrets or loader-injection variables, with
 * `extra` applied on top (extra wins, so a sidecar's own key survives).
 */
function buildSidecarEnv(baseEnv, extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(baseEnv || {})) {
    if (value === undefined || isStrippedEnvName(name)) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null) continue;
    env[name] = String(value);
  }
  return env;
}

module.exports = { buildSidecarEnv, isSecretEnvName, isStrippedEnvName };
