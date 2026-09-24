/**
 * Project notes — ties voice notes (the .md files), their recorded dictation
 * (bf_entries) and projects together.
 *
 * - fn+P saves a note into the default project (settings.defaultProjectId,
 *   falling back to an "Inbox" created on first use).
 * - A note's frontmatter carries `entry` (its dictation) and
 *   `project` / `project_id`; the dictation's project_id follows the note.
 */

const appInit = require("./app-init");
const { saveAsMarkdown, readSettings, updateSettings } = require("./markdown-route");
const notesFolder = require("./notes-folder");
const { pickDefaultProject, checkProjectName } = require("./project-notes-pure");
const { resolveAudioSource } = require("./regenerate-entry-pure");

function findProject(id) {
  return appInit.getWhisperWoofProjects().find((p) => p.id === id) ?? null;
}

/** The project fn+P files into, creating "Inbox" if needed. */
function getDefaultProject() {
  const { project, create } = pickDefaultProject(
    appInit.getWhisperWoofProjects(),
    readSettings().defaultProjectId ?? null
  );
  if (project) return { id: project.id, name: project.name };
  const created = appInit.createWhisperWoofProject(create);
  if (!created) throw new Error("WhisperWoof database not initialized");
  updateSettings({ defaultProjectId: created.id });
  return { id: created.id, name: created.name };
}

/** The current default without creating anything (for display); null if none yet. */
function peekDefaultProject() {
  const { project } = pickDefaultProject(
    appInit.getWhisperWoofProjects(),
    readSettings().defaultProjectId ?? null
  );
  return project ? { id: project.id, name: project.name } : null;
}

function setDefaultProject(projectId) {
  if (!findProject(projectId)) throw new Error("Unknown project");
  updateSettings({ defaultProjectId: projectId });
  return projectId;
}

/** fn+P: save the text as a note in the default project. */
function saveProjectNote(text) {
  const project = getDefaultProject();
  const result = saveAsMarkdown(text, { project: project.name, project_id: project.id });
  return { ...result, project };
}

/** Record which dictation a note came from; the dictation joins the note's project. */
function linkNoteToEntry(name, entryId) {
  if (!appInit.getWhisperWoofEntryRow(entryId)) throw new Error("Unknown entry");
  const note = notesFolder.setNoteFields(name, { entry: entryId });
  if (note.projectId && findProject(note.projectId)) appInit.setEntryProject(entryId, note.projectId);
  return note;
}

/** Move a note into a project (or out, with null); its dictation follows. */
function setNoteProject(name, projectId) {
  const project = projectId ? findProject(projectId) : null;
  if (projectId && !project) throw new Error("Unknown project");
  const note = notesFolder.setNoteFields(name, {
    project: project ? project.name : null,
    project_id: project ? project.id : null,
  });
  if (note.entryId) appInit.setEntryProject(note.entryId, project ? project.id : null);
  return note;
}

function nameOrThrow(raw, exceptId) {
  const check = checkProjectName(raw, appInit.getWhisperWoofProjects(), exceptId);
  if (!check.ok) throw new Error(check.error);
  return check.name;
}

function createProject(rawName) {
  const created = appInit.createWhisperWoofProject(nameOrThrow(rawName, null));
  if (!created) throw new Error("WhisperWoof database not initialized");
  return { id: created.id, name: created.name };
}

/** Rename, and update the name written in the project's notes. */
function renameProject(projectId, rawName) {
  if (!findProject(projectId)) throw new Error("Unknown project");
  const name = nameOrThrow(rawName, projectId);
  appInit.renameWhisperWoofProject(projectId, name);
  for (const note of listProjectNotes(projectId)) {
    notesFolder.setNoteFields(note.name, { project: name });
  }
  return { id: projectId, name };
}

/** Delete a project; its notes (and their dictations) are kept, just unfiled. */
function deleteProject(projectId) {
  for (const note of listProjectNotes(projectId)) {
    notesFolder.setNoteFields(note.name, { project: null, project_id: null });
  }
  appInit.deleteWhisperWoofProject(projectId);
  if (readSettings().defaultProjectId === projectId) updateSettings({ defaultProjectId: null });
  return projectId;
}

function listProjectNotes(projectId) {
  return notesFolder.listNotes().notes.filter((note) => note.projectId === projectId);
}

/** The recording behind a note's dictation, as an upstream transcription id. */
function getEntryRecordingId(entryId) {
  const source = resolveAudioSource(appInit.getWhisperWoofEntryRow(entryId));
  return source && source.kind === "upstream" ? source.id : null;
}

module.exports = {
  getDefaultProject,
  peekDefaultProject,
  setDefaultProject,
  saveProjectNote,
  linkNoteToEntry,
  setNoteProject,
  listProjectNotes,
  createProject,
  renameProject,
  deleteProject,
  getEntryRecordingId,
};
