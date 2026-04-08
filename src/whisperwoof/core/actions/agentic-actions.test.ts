/**
 * Tests for Agentic Actions — intent detection and action routing
 *
 * Imports from the actual source module (no duplicated implementation).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock debugLogger before importing the source module
vi.mock('../../helpers/debugLogger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Import from the actual source — single source of truth
const {
  detectActionIntent,
  ACTION_PATTERNS,
  getAvailableActions,
} = require('../../bridge/agentic-actions');

describe('Agentic Actions', () => {
  describe('calendar intent', () => {
    it('detects meeting scheduling', () => {
      expect(detectActionIntent("Schedule a meeting with Sarah for Friday")?.id).toBe("calendar");
      expect(detectActionIntent("Book a call with the team at 3pm")?.id).toBe("calendar");
      expect(detectActionIntent("Set up an appointment with the dentist")?.id).toBe("calendar");
      expect(detectActionIntent("Create an event for the launch party")?.id).toBe("calendar");
    });

    it('detects calendar additions', () => {
      expect(detectActionIntent("Add the demo to my calendar")?.id).toBe("calendar");
      expect(detectActionIntent("Put the standup on my schedule")?.id).toBe("calendar");
    });

    it('detects blocking/reserving time', () => {
      expect(detectActionIntent("Block time for deep work")?.id).toBe("calendar");
      expect(detectActionIntent("Reserve my calendar for the afternoon")?.id).toBe("calendar");
    });

    it('routes to calendar plugin with correct tool', () => {
      const action = detectActionIntent("Schedule a meeting with Sarah");
      expect(action?.plugin).toBe("calendar");
      expect(action?.tool).toBe("create_event");
      expect(action?.label).toBe("Create calendar event");
    });

    it('includes spokenText in result', () => {
      const action = detectActionIntent("  Schedule a meeting with Sarah  ");
      expect(action?.spokenText).toBe("Schedule a meeting with Sarah");
    });
  });

  describe('slack intent', () => {
    it('detects Slack messages', () => {
      expect(detectActionIntent("Send a Slack message to the engineering channel")?.id).toBe("slack");
      expect(detectActionIntent("Post a message in the general channel")?.id).toBe("slack");
      expect(detectActionIntent("Message the team on Slack")?.id).toBe("slack");
    });

    it('detects shorthand slack commands', () => {
      expect(detectActionIntent("Slack the team about the deploy")?.id).toBe("slack");
    });

    it('routes to slack plugin', () => {
      const action = detectActionIntent("Send a Slack message to the team");
      expect(action?.plugin).toBe("slack");
      expect(action?.tool).toBe("send_message");
    });
  });

  describe('todoist intent', () => {
    it('detects task creation', () => {
      expect(detectActionIntent("Add a task to buy groceries")?.id).toBe("todoist");
      expect(detectActionIntent("Create a reminder to call Sarah")?.id).toBe("todoist");
      expect(detectActionIntent("Remind me to submit the report")?.id).toBe("todoist");
    });

    it('detects "need to" as task intent', () => {
      expect(detectActionIntent("I need to finish the presentation by Friday")?.id).toBe("todoist");
    });

    it('detects adding to todo list', () => {
      expect(detectActionIntent("Put buy milk on my todo list")?.id).toBe("todoist");
      expect(detectActionIntent("Add laundry to my task list")?.id).toBe("todoist");
    });

    it('routes to todoist plugin with correct label', () => {
      const action = detectActionIntent("Add a task to call the dentist");
      expect(action?.plugin).toBe("todoist");
      expect(action?.tool).toBe("add_task");
      expect(action?.label).toBe("Add task to Todoist");
    });
  });

  describe('notion intent', () => {
    it('detects Notion page creation', () => {
      expect(detectActionIntent("Create a Notion page with today's notes")?.id).toBe("notion");
      expect(detectActionIntent("Save this to Notion")?.id).toBe("notion");
      expect(detectActionIntent("Make a document for the project")?.id).toBe("notion");
    });

    it('routes to notion plugin', () => {
      const action = detectActionIntent("Create a Notion page for the project");
      expect(action?.plugin).toBe("notion");
      expect(action?.tool).toBe("create_page");
    });
  });

  describe('email intent', () => {
    it('detects email sending', () => {
      expect(detectActionIntent("Send an email to John about the project")?.id).toBe("email");
      expect(detectActionIntent("Write an email to the client")?.id).toBe("email");
      expect(detectActionIntent("Draft an email to Sarah")?.id).toBe("email");
    });

    it('detects shorthand email commands', () => {
      expect(detectActionIntent("Email Sarah about the deadline")?.id).toBe("email");
    });

    it('routes to email plugin', () => {
      const action = detectActionIntent("Send an email to John about the project");
      expect(action?.plugin).toBe("email");
      expect(action?.tool).toBe("send_email");
    });
  });

  describe('non-action text', () => {
    it('returns null for normal speech', () => {
      expect(detectActionIntent("The weather is nice today")).toBeNull();
      expect(detectActionIntent("I was thinking about the project")).toBeNull();
      expect(detectActionIntent("Let me explain the architecture")).toBeNull();
    });

    it('returns null for short/null input', () => {
      expect(detectActionIntent("")).toBeNull();
      expect(detectActionIntent(null)).toBeNull();
      expect(detectActionIntent("hello")).toBeNull();
    });
  });

  describe('action registry', () => {
    it('has 5 action types', () => {
      expect(ACTION_PATTERNS).toHaveLength(5);
    });

    it('all have unique IDs', () => {
      const ids = ACTION_PATTERNS.map((a: { id: string }) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each action maps to a plugin and tool', () => {
      for (const action of ACTION_PATTERNS) {
        expect(action.plugin).toBeTruthy();
        expect(action.tool).toBeTruthy();
        expect(action.label).toBeTruthy();
      }
    });

    it('each action has at least one pattern', () => {
      for (const action of ACTION_PATTERNS) {
        expect(action.patterns.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('calendar has 3 patterns', () => {
      const calendar = ACTION_PATTERNS.find((a: { id: string }) => a.id === 'calendar');
      expect(calendar.patterns).toHaveLength(3);
    });

    it('slack has 3 patterns', () => {
      const slack = ACTION_PATTERNS.find((a: { id: string }) => a.id === 'slack');
      expect(slack.patterns).toHaveLength(3);
    });

    it('todoist has 3 patterns', () => {
      const todoist = ACTION_PATTERNS.find((a: { id: string }) => a.id === 'todoist');
      expect(todoist.patterns).toHaveLength(3);
    });

    it('email has 2 patterns', () => {
      const email = ACTION_PATTERNS.find((a: { id: string }) => a.id === 'email');
      expect(email.patterns).toHaveLength(2);
    });
  });

  describe('getAvailableActions', () => {
    it('returns all actions with id, plugin, and label', () => {
      const actions = getAvailableActions();
      expect(actions).toHaveLength(5);

      for (const action of actions) {
        expect(action).toHaveProperty('id');
        expect(action).toHaveProperty('plugin');
        expect(action).toHaveProperty('label');
      }
    });

    it('does not expose patterns or tool fields', () => {
      const actions = getAvailableActions();
      for (const action of actions) {
        expect(action).not.toHaveProperty('patterns');
        expect(action).not.toHaveProperty('tool');
      }
    });
  });
});
