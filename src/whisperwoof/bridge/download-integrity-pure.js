/**
 * Rules for downloading executables and models: HTTPS only (including every
 * redirect hop), the GitHub token only for api.github.com, and the SHA-256
 * that GitHub publishes for each release asset (`digest: "sha256:<hex>"`).
 */

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function isHttpsUrl(url) {
  try {
    return new URL(String(url)).protocol === "https:";
  } catch {
    return false;
  }
}

function insecureUrlError(message) {
  return Object.assign(new Error(message), { code: "ERR_INSECURE_URL" });
}

/** Throws unless `url` is an absolute https: URL. Returns it normalized. */
function requireHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw insecureUrlError("Refusing to download from an invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw insecureUrlError(`Refusing to download over ${parsed.protocol.replace(":", "")}`);
  }
  return parsed.toString();
}

/**
 * Resolves a redirect's Location against the URL that answered with it and
 * refuses anything that isn't https (a downgrade would let a network attacker
 * substitute the file).
 */
function resolveHttpsRedirect(fromUrl, location) {
  if (!location) {
    throw Object.assign(new Error("Redirect without a Location header"), {
      code: "ERR_BAD_REDIRECT",
    });
  }
  let next;
  try {
    next = new URL(String(location), String(fromUrl));
  } catch {
    throw Object.assign(new Error("Redirect to an invalid URL"), { code: "ERR_BAD_REDIRECT" });
  }
  if (next.protocol !== "https:") {
    throw Object.assign(
      new Error(`Refusing redirect to a non-HTTPS URL (${next.protocol.replace(":", "")})`),
      { code: "ERR_INSECURE_REDIRECT" }
    );
  }
  return next.toString();
}

/** A GitHub token is only ever sent to the GitHub API itself, over https. */
function githubTokenAllowed(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && u.hostname === "api.github.com";
  } catch {
    return false;
  }
}

/** Lower-case 64-hex SHA-256, or null for a missing value. Throws on garbage. */
function normalizeSha256(value) {
  if (value === undefined || value === null || value === "") return null;
  const hex = String(value).trim().toLowerCase();
  if (!SHA256_HEX_RE.test(hex)) {
    throw Object.assign(new Error("Invalid SHA-256 digest"), { code: "ERR_BAD_DIGEST" });
  }
  return hex;
}

/**
 * GitHub release asset `digest` → SHA-256 hex. Null when GitHub published
 * none (assets uploaded before digests existed) or used another algorithm;
 * throws when it claims sha256 but the value is malformed.
 */
function parseGithubDigest(digest) {
  if (typeof digest !== "string" || digest.length === 0) return null;
  const match = /^sha256:(.*)$/i.exec(digest.trim());
  if (!match) return null;
  return normalizeSha256(match[1]);
}

function checksumMismatchError(expected, actual) {
  return Object.assign(
    new Error(`Downloaded file failed its SHA-256 check (expected ${expected}, got ${actual})`),
    { code: "ERR_CHECKSUM_MISMATCH", isChecksumError: true }
  );
}

module.exports = {
  isHttpsUrl,
  requireHttpsUrl,
  resolveHttpsRedirect,
  githubTokenAllowed,
  normalizeSha256,
  parseGithubDigest,
  checksumMismatchError,
};
