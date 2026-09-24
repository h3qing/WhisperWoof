/**
 * The app being dictated into, read at hotkey press (before the overlay can
 * take focus) by TextEditMonitor.captureTargetPid. The JXA one-liner prints
 * "<pid>|<bundle id>"; Memory uses the pid to watch the pasted field and the
 * bundle id to tag learned words and boost that app's words in STT hints.
 */

const FRONTMOST_APP_JXA =
  'ObjC.import("AppKit"); var a = $.NSWorkspace.sharedWorkspace.frontmostApplication; ' +
  'a.processIdentifier + "|" + (ObjC.unwrap(a.bundleIdentifier) || "")';

/** @returns {{pid: number | null, bundleId: string | null}} */
function parseFrontmostApp(stdout) {
  const [pidText = "", bundleId = ""] = String(stdout || "").trim().split("|");
  const pid = parseInt(pidText, 10);
  return { pid: Number.isNaN(pid) ? null : pid, bundleId: bundleId || null };
}

module.exports = { FRONTMOST_APP_JXA, parseFrontmostApp };
