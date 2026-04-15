/**
 * Entry Templates — pure logic (no electron/fs/app/debugLogger)
 *
 * Extracted from entry-templates.js so tests can import without
 * triggering Electron side effects at load time.
 */

const MAX_TEMPLATES = 50;

const BUILT_IN_TEMPLATES = [
  {
    id: "builtin-standup",
    name: "Daily Standup",
    description: "Yesterday / Today / Blockers format",
    icon: "calendar",
    sections: [
      { id: "yesterday", label: "Yesterday", prompt: "What did you work on yesterday?", required: true },
      { id: "today", label: "Today", prompt: "What are you working on today?", required: true },
      { id: "blockers", label: "Blockers", prompt: "Any blockers or issues?", required: false },
    ],
    outputFormat: "## Daily Standup\n\n**Yesterday:**\n{{yesterday}}\n\n**Today:**\n{{today}}\n\n**Blockers:**\n{{blockers}}",
    builtIn: true,
  },
  {
    id: "builtin-meeting",
    name: "Meeting Notes",
    description: "Attendees / Agenda / Decisions / Action Items",
    icon: "users",
    sections: [
      { id: "attendees", label: "Attendees", prompt: "Who attended?", required: false },
      { id: "agenda", label: "Agenda", prompt: "What was discussed?", required: true },
      { id: "decisions", label: "Decisions", prompt: "What was decided?", required: false },
      { id: "actions", label: "Action Items", prompt: "What are the next steps?", required: false },
    ],
    outputFormat: "## Meeting Notes\n\n**Attendees:** {{attendees}}\n\n**Discussion:**\n{{agenda}}\n\n**Decisions:**\n{{decisions}}\n\n**Action Items:**\n{{actions}}",
    builtIn: true,
  },
  {
    id: "builtin-bug",
    name: "Bug Report",
    description: "What / Steps / Expected / Actual",
    icon: "bug",
    sections: [
      { id: "summary", label: "Summary", prompt: "What's the bug?", required: true },
      { id: "steps", label: "Steps to Reproduce", prompt: "How do you trigger it?", required: true },
      { id: "expected", label: "Expected Behavior", prompt: "What should happen?", required: true },
      { id: "actual", label: "Actual Behavior", prompt: "What actually happens?", required: true },
    ],
    outputFormat: "## Bug Report\n\n**Summary:** {{summary}}\n\n**Steps to Reproduce:**\n{{steps}}\n\n**Expected:** {{expected}}\n\n**Actual:** {{actual}}",
    builtIn: true,
  },
  {
    id: "builtin-email",
    name: "Quick Email Draft",
    description: "To / Subject / Body",
    icon: "mail",
    sections: [
      { id: "to", label: "To", prompt: "Who is this email for?", required: true },
      { id: "subject", label: "Subject", prompt: "What's the subject?", required: true },
      { id: "body", label: "Body", prompt: "What do you want to say?", required: true },
    ],
    outputFormat: "To: {{to}}\nSubject: {{subject}}\n\n{{body}}",
    builtIn: true,
  },
  {
    id: "builtin-update",
    name: "Project Update",
    description: "Progress / Risks / Next Steps",
    icon: "trending-up",
    sections: [
      { id: "progress", label: "Progress", prompt: "What's been accomplished?", required: true },
      { id: "risks", label: "Risks", prompt: "Any risks or concerns?", required: false },
      { id: "next", label: "Next Steps", prompt: "What's coming next?", required: true },
    ],
    outputFormat: "## Project Update\n\n**Progress:**\n{{progress}}\n\n**Risks:**\n{{risks}}\n\n**Next Steps:**\n{{next}}",
    builtIn: true,
  },
];

function renderTemplateFromObject(template, values) {
  if (!template) return { success: false, error: "Template not found" };

  for (const section of template.sections) {
    if (section.required && (!values[section.id] || !values[section.id].trim())) {
      return { success: false, error: `Required section "${section.label}" is empty` };
    }
  }

  let output = template.outputFormat;
  for (const section of template.sections) {
    const value = (values[section.id] || "").trim() || "(none)";
    output = output.replace(new RegExp(`\\{\\{${section.id}\\}\\}`, "g"), value);
  }

  return { success: true, output };
}

function getNextSectionFromObject(template, filledSections) {
  if (!template) return null;
  const filled = new Set(Object.keys(filledSections || {}));
  return template.sections.find((s) => !filled.has(s.id)) || null;
}

module.exports = {
  BUILT_IN_TEMPLATES,
  MAX_TEMPLATES,
  renderTemplateFromObject,
  getNextSectionFromObject,
};
