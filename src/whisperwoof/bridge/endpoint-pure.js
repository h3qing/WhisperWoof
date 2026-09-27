/**
 * Where the app may send audio, text and API keys. HTTPS anywhere; plain
 * http only to this machine or the local network, and only for literal
 * addresses ("10.attacker.com" is a public name). Mirror of
 * src/utils/urlUtils.ts for the main process (keep the two in step).
 */

function ipv4Octets(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isPrivateHost(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const ip = ipv4Octets(h);
  if (ip) {
    const [a, b] = ip;
    return (
      a === 127 ||
      a === 10 ||
      (a === 0 && ip.every((o) => o === 0)) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    );
  }
  if (h.includes(":")) return h === "::1" || /^fe[89ab]/.test(h) || /^f[cd]/.test(h);
  return false;
}

function isSecureEndpoint(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

/** A server on this computer or the local network (a local model such as Ollama). */
function isLocalEndpoint(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = { isPrivateHost, isSecureEndpoint, isLocalEndpoint };
