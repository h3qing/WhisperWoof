/**
 * Tests for App Automation — command detection and app name extraction
 *
 * Imports from the actual source module (no duplicated implementation).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock debugLogger and child_process before importing the source module
vi.mock('../../helpers/debugLogger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Import from the actual source — single source of truth
const { detectAutomationCommand, getAutomationCommands, AUTOMATION_COMMANDS } = require('../../bridge/app-automation');

describe('App Automation', () => {
  describe('open/launch', () => {
    it('detects "open Safari"', () => {
      const r = detectAutomationCommand("open Safari");
      expect(r?.id).toBe("open");
      expect(r?.appName).toBe("Safari");
    });

    it('detects "launch Terminal"', () => {
      const r = detectAutomationCommand("launch Terminal");
      expect(r?.id).toBe("open");
      expect(r?.appName).toBe("Terminal");
    });

    it('detects "start Slack"', () => {
      const r = detectAutomationCommand("start Slack");
      expect(r?.id).toBe("open");
      expect(r?.appName).toBe("Slack");
    });

    it('handles multi-word app names', () => {
      const r = detectAutomationCommand("open Visual Studio Code");
      expect(r?.appName).toBe("Visual Studio Code");
    });
  });

  describe('switch to', () => {
    it('detects "switch to VS Code"', () => {
      const r = detectAutomationCommand("switch to VS Code");
      expect(r?.id).toBe("switch");
      expect(r?.appName).toBe("VS Code");
    });

    it('detects "go to Chrome"', () => {
      const r = detectAutomationCommand("go to Chrome");
      expect(r?.id).toBe("switch");
      expect(r?.appName).toBe("Chrome");
    });
  });

  describe('window management', () => {
    it('detects "close this window"', () => {
      expect(detectAutomationCommand("close this window")?.id).toBe("close");
      expect(detectAutomationCommand("close window")?.id).toBe("close");
      expect(detectAutomationCommand("close tab")?.id).toBe("close");
    });

    it('detects "minimize"', () => {
      expect(detectAutomationCommand("minimize")?.id).toBe("minimize");
      expect(detectAutomationCommand("minimize this")?.id).toBe("minimize");
      expect(detectAutomationCommand("hide this window")?.id).toBe("minimize");
    });

    it('detects fullscreen', () => {
      expect(detectAutomationCommand("fullscreen")?.id).toBe("fullscreen");
      expect(detectAutomationCommand("full screen")?.id).toBe("fullscreen");
      expect(detectAutomationCommand("maximize")?.id).toBe("fullscreen");
    });

    it('detects new tab/window', () => {
      expect(detectAutomationCommand("new tab")?.id).toBe("newTab");
      expect(detectAutomationCommand("open a new tab")?.id).toBe("newTab");
      expect(detectAutomationCommand("new window")?.id).toBe("newWindow");
    });
  });

  describe('system controls', () => {
    it('detects mute', () => {
      expect(detectAutomationCommand("mute")?.id).toBe("mute");
      expect(detectAutomationCommand("unmute")?.id).toBe("mute");
    });

    it('detects volume controls', () => {
      expect(detectAutomationCommand("volume up")?.id).toBe("volumeUp");
      expect(detectAutomationCommand("louder")?.id).toBe("volumeUp");
      expect(detectAutomationCommand("volume down")?.id).toBe("volumeDown");
      expect(detectAutomationCommand("quieter")?.id).toBe("volumeDown");
    });

    it('detects dark mode', () => {
      expect(detectAutomationCommand("dark mode")?.id).toBe("darkMode");
      expect(detectAutomationCommand("toggle dark mode")?.id).toBe("darkMode");
      expect(detectAutomationCommand("turn on dark mode")?.id).toBe("darkMode");
    });
  });

  describe('non-automation', () => {
    it('returns null for normal speech', () => {
      expect(detectAutomationCommand("I need to buy groceries")).toBeNull();
      expect(detectAutomationCommand("The meeting is at 3pm")).toBeNull();
      expect(detectAutomationCommand("Create a function")).toBeNull();
    });

    it('returns null for short/null', () => {
      expect(detectAutomationCommand("")).toBeNull();
      expect(detectAutomationCommand(null)).toBeNull();
      expect(detectAutomationCommand("hi")).toBeNull();
    });
  });

  describe('command registry', () => {
    it('has 12 commands', () => {
      expect(Object.keys(AUTOMATION_COMMANDS)).toHaveLength(12);
    });

    it('all have unique IDs', () => {
      const ids = Object.values(AUTOMATION_COMMANDS).map((c: any) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('getAutomationCommands', () => {
    it('returns all commands with id and label', () => {
      const commands = getAutomationCommands();
      expect(commands.length).toBeGreaterThanOrEqual(11);
      for (const cmd of commands) {
        expect(cmd).toHaveProperty('id');
        expect(cmd).toHaveProperty('label');
      }
    });
  });
});
