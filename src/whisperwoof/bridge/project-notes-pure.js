/**
 * Project notes — pure rules (no fs, no db).
 * fn+P files a note into the default project; with none saved (or it was
 * deleted) it falls back to "Inbox", created on first use.
 */

const INBOX_NAME = "Inbox";

/** { project } to use, or { create: name } when a project must be created first. */
function pickDefaultProject(projects, savedId) {
  const saved = savedId ? projects.find((p) => p.id === savedId) : null;
  if (saved) return { project: saved, create: null };
  const existingInbox = projects.find((p) => p.name === INBOX_NAME);
  if (existingInbox) return { project: existingInbox, create: null };
  return { project: null, create: INBOX_NAME };
}

const MAX_PROJECT_NAME = 80;

/** A usable project name: trimmed, 1-80 chars, unique (ignoring case) except for `exceptId`. */
function checkProjectName(raw, projects, exceptId = null) {
  const name = String(raw ?? "").trim();
  if (!name) return { ok: false, error: "Give the project a name" };
  if (name.length > MAX_PROJECT_NAME) return { ok: false, error: "That name is too long" };
  const taken = projects.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
  if (taken) return { ok: false, error: "A project with that name already exists" };
  return { ok: true, name };
}

module.exports = { INBOX_NAME, pickDefaultProject, checkProjectName };
