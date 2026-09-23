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
const { pickDefaultProject } = require("./project-notes-pure");
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
  setDefaultProject,
  saveProjectNote,
  linkNoteToEntry,
  setNoteProject,
  listProjectNotes,
  getEntryRecordingId,
};
