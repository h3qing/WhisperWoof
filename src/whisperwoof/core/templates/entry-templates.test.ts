/**
 * Tests for Entry Templates — structured capture formats
 *
 * Imports from the actual pure module (no duplicated implementation).
 */

import { describe, it, expect } from 'vitest';

// Import from the pure module — no electron/fs side effects
const { BUILT_IN_TEMPLATES, renderTemplateFromObject, getNextSectionFromObject } = require('../../bridge/entry-templates-pure');

const STANDUP = BUILT_IN_TEMPLATES.find((t: any) => t.id === "builtin-standup");
const BUG_REPORT = BUILT_IN_TEMPLATES.find((t: any) => t.id === "builtin-bug");

describe('Entry Templates', () => {
  describe('renderTemplateFromObject', () => {
    it('renders standup template', () => {
      const result = renderTemplateFromObject(STANDUP, {
        yesterday: "Fixed the login bug",
        today: "Working on the dashboard",
        blockers: "None",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Fixed the login bug");
      expect(result.output).toContain("Working on the dashboard");
      expect(result.output).toContain("## Daily Standup");
    });

    it('renders bug report template', () => {
      const result = renderTemplateFromObject(BUG_REPORT, {
        summary: "Login page crashes",
        steps: "1. Open login\n2. Click submit",
        expected: "Login succeeds",
        actual: "Page crashes",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Login page crashes");
      expect(result.output).toContain("## Bug Report");
    });

    it('fails when required section is empty', () => {
      const result = renderTemplateFromObject(STANDUP, {
        yesterday: "Fixed bugs",
        // today is missing (required)
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Today");
    });

    it('allows empty optional sections', () => {
      const result = renderTemplateFromObject(STANDUP, {
        yesterday: "Fixed bugs",
        today: "Dashboard work",
        // blockers is optional
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("(none)");
    });

    it('replaces all placeholders', () => {
      const result = renderTemplateFromObject(STANDUP, {
        yesterday: "A",
        today: "B",
        blockers: "C",
      });
      expect(result.output).not.toContain("{{");
      expect(result.output).not.toContain("}}");
    });

    it('returns error for null template', () => {
      const result = renderTemplateFromObject(null, { foo: "bar" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Template not found");
    });
  });

  describe('getNextSectionFromObject', () => {
    it('returns first section when nothing filled', () => {
      const next = getNextSectionFromObject(STANDUP, {});
      expect(next?.id).toBe("yesterday");
    });

    it('returns second section when first is filled', () => {
      const next = getNextSectionFromObject(STANDUP, { yesterday: "Done" });
      expect(next?.id).toBe("today");
    });

    it('returns null when all sections filled', () => {
      const next = getNextSectionFromObject(STANDUP, {
        yesterday: "A",
        today: "B",
        blockers: "C",
      });
      expect(next).toBeNull();
    });

    it('skips to unfilled sections', () => {
      const next = getNextSectionFromObject(BUG_REPORT, {
        summary: "Bug",
        steps: "1. Click",
      });
      expect(next?.id).toBe("expected");
    });

    it('returns null for null template', () => {
      expect(getNextSectionFromObject(null, {})).toBeNull();
    });
  });

  describe('built-in templates', () => {
    it('has 5 built-in templates', () => {
      expect(BUILT_IN_TEMPLATES).toHaveLength(5);
    });

    it('all have unique IDs', () => {
      const ids = BUILT_IN_TEMPLATES.map((t: any) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all are marked builtIn', () => {
      for (const t of BUILT_IN_TEMPLATES) {
        expect((t as any).builtIn).toBe(true);
      }
    });

    it('all have at least one section', () => {
      for (const t of BUILT_IN_TEMPLATES) {
        expect((t as any).sections.length).toBeGreaterThan(0);
      }
    });

    it('all sections have id, label, prompt', () => {
      for (const t of BUILT_IN_TEMPLATES) {
        for (const s of (t as any).sections) {
          expect(s.id).toBeTruthy();
          expect(s.label).toBeTruthy();
          expect(s.prompt).toBeTruthy();
        }
      }
    });

    it('output format references all section IDs', () => {
      for (const t of BUILT_IN_TEMPLATES) {
        for (const s of (t as any).sections) {
          expect((t as any).outputFormat).toContain(`{{${s.id}}}`);
        }
      }
    });
  });

  describe('validation', () => {
    it('whitespace-only values count as empty', () => {
      const result = renderTemplateFromObject(STANDUP, {
        yesterday: "   ",
        today: "Work",
      });
      expect(result.success).toBe(false);
    });

    it('trims values before rendering', () => {
      const result = renderTemplateFromObject(STANDUP, {
        yesterday: "  Fixed bugs  ",
        today: "  Dashboard  ",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Fixed bugs");
      expect(result.output).not.toContain("  Fixed bugs  ");
    });
  });
});
