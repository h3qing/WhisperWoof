/**
 * Entry Templates — Structured capture formats filled by voice
 *
 * Predefined templates with sections that the user fills by speaking.
 * When a template is active, voice input fills the next empty section
 * instead of being a freeform entry.
 *
 * Built-in templates:
 * - Standup (yesterday/today/blockers)
 * - Meeting Notes (attendees/agenda/decisions/action items)
 * - Bug Report (what happened/steps to reproduce/expected/actual)
 * - Quick Email Draft (to/subject/body)
 * - Project Update (progress/risks/next steps)
 *
 * Users can also create custom templates.
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-templates.json
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { BUILT_IN_TEMPLATES, MAX_TEMPLATES, renderTemplateFromObject, getNextSectionFromObject } = require("./entry-templates-pure");

const TEMPLATES_FILE = path.join(app.getPath("userData"), "whisperwoof-templates.json");

// --- Storage ---

function loadCustomTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      return JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf-8"));
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load templates", { error: err.message });
  }
  return [];
}

function saveCustomTemplates(templates) {
  try {
    const dir = path.dirname(TEMPLATES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save templates", { error: err.message });
  }
}

// --- CRUD ---

function getAllTemplates() {
  const custom = loadCustomTemplates();
  return [...BUILT_IN_TEMPLATES, ...custom];
}

function getTemplate(id) {
  return getAllTemplates().find((t) => t.id === id) || null;
}

function createTemplate(config) {
  if (!config.name || !config.name.trim()) {
    return { success: false, error: "Template name is required" };
  }
  if (!Array.isArray(config.sections) || config.sections.length === 0) {
    return { success: false, error: "At least one section is required" };
  }

  const custom = loadCustomTemplates();
  if (custom.length >= MAX_TEMPLATES) {
    return { success: false, error: `Maximum ${MAX_TEMPLATES} custom templates` };
  }

  const template = {
    id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: config.name.trim(),
    description: (config.description || "").trim(),
    icon: config.icon || "file-text",
    sections: config.sections.map((s, i) => ({
      id: s.id || `section-${i}`,
      label: s.label || `Section ${i + 1}`,
      prompt: s.prompt || "",
      required: s.required !== false,
    })),
    outputFormat: config.outputFormat || config.sections.map((s, i) => `**${s.label || "Section"}:**\n{{${s.id || `section-${i}`}}}`).join("\n\n"),
    builtIn: false,
    createdAt: new Date().toISOString(),
  };

  custom.push(template);
  saveCustomTemplates(custom);

  return { success: true, template };
}

function deleteTemplate(id) {
  // Can't delete built-in templates
  if (id.startsWith("builtin-")) {
    return { success: false, error: "Cannot delete built-in templates" };
  }

  const custom = loadCustomTemplates();
  const filtered = custom.filter((t) => t.id !== id);
  if (filtered.length === custom.length) {
    return { success: false, error: "Template not found" };
  }
  saveCustomTemplates(filtered);
  return { success: true };
}

// --- Template rendering ---

/**
 * Render a template with filled section values.
 *
 * @param {string} templateId
 * @param {Record<string, string>} values — { sectionId: "spoken text" }
 * @returns {{ success: boolean, output?: string, error?: string }}
 */
function renderTemplate(templateId, values) {
  const template = getTemplate(templateId);
  return renderTemplateFromObject(template, values);
}

/**
 * Get the next unfilled section in a template session.
 */
function getNextSection(templateId, filledSections) {
  const template = getTemplate(templateId);
  return getNextSectionFromObject(template, filledSections);
}

module.exports = {
  getAllTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  renderTemplate,
  getNextSection,
  BUILT_IN_TEMPLATES,
};
