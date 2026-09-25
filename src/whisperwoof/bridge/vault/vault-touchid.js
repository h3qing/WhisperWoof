/**
 * Touch ID through resources/macos-vault-helper (Secure Enclave key that
 * needs a fingerprint for every use). Input goes over stdin, one JSON result
 * comes back on stdout. macOS only; elsewhere Touch ID is simply unavailable.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BINARY = "macos-vault-helper";
const UNLOCK_TIMEOUT_MS = 120000;
const QUICK_TIMEOUT_MS = 10000;

let cachedBinary;

function resolveBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const candidates = [
    path.join(__dirname, "..", "..", "..", "..", "resources", "bin", BINARY),
    ...(process.resourcesPath
      ? [
          path.join(process.resourcesPath, BINARY),
          path.join(process.resourcesPath, "bin", BINARY),
          path.join(process.resourcesPath, "resources", "bin", BINARY),
          path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", BINARY),
        ]
      : []),
  ];
  cachedBinary =
    candidates.find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null;
  return cachedBinary;
}

function run(command, input, timeoutMs) {
  const binary = process.platform === "darwin" ? resolveBinary() : null;
  if (!binary) return Promise.resolve({ error: "unavailable", message: "Touch ID isn't available" });
  return new Promise((resolve) => {
    const child = spawn(binary, [command], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => resolve({ error: "unavailable", message: "Touch ID isn't available" }));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() || "{}"));
      } catch {
        resolve({ error: "failed", message: "Touch ID didn't answer" });
      }
    });
    child.stdin.end(input ? JSON.stringify(input) : "");
  });
}

/** { available, reason? } — reason: notEnrolled | unavailable | lockout */
async function getAvailability() {
  const result = await run("status", null, QUICK_TIMEOUT_MS);
  if (result.error || !result.secureEnclave) return { available: false, reason: "unavailable" };
  if (result.biometry === "available") return { available: true };
  return { available: false, reason: ["notEnrolled", "lockout"].includes(result.biometry) ? result.biometry : "unavailable" };
}

/** Make a new Secure Enclave key. No prompt. → { publicKey: Buffer, keyBlob: Buffer } */
async function createKey() {
  const result = await run("create", null, QUICK_TIMEOUT_MS);
  if (result.error) throw Object.assign(new Error(result.message), { code: result.error.toUpperCase() });
  return { publicKey: Buffer.from(result.publicKey, "base64"), keyBlob: Buffer.from(result.keyBlob, "base64") };
}

/** Ask for a fingerprint and do the ECDH in the enclave. → shared secret Buffer */
async function deriveSecret({ keyBlob, peer, reason }) {
  const result = await run(
    "unlock",
    { keyBlob: keyBlob.toString("base64"), peer: peer.toString("base64"), reason, cancelTitle: "Cancel" },
    UNLOCK_TIMEOUT_MS
  );
  if (result.error) throw Object.assign(new Error(result.message), { code: result.error.toUpperCase() });
  return Buffer.from(result.shared, "base64");
}

module.exports = { getAvailability, createKey, deriveSecret };
