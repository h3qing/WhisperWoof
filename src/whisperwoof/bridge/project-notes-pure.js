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

module.exports = { INBOX_NAME, pickDefaultProject };
