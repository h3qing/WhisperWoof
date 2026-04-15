/**
 * Tests for Conversation Memory — query detection and topic extraction
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
const { isMemoryQuery, extractQueryTopic, getMemoryQueryExamples, MEMORY_PATTERNS } = require('../../bridge/conversation-memory');

describe('Conversation Memory', () => {
  describe('isMemoryQuery', () => {
    it('detects "what did I say about" queries', () => {
      expect(isMemoryQuery("What did I say about the budget?")).toBe(true);
      expect(isMemoryQuery("What did I mention about the deadline?")).toBe(true);
      expect(isMemoryQuery("What was I saying about the project?")).toBe(true);
    });

    it('detects "when did I" queries', () => {
      expect(isMemoryQuery("When did I mention Sarah?")).toBe(true);
      expect(isMemoryQuery("When did I talk about the deployment?")).toBe(true);
    });

    it('detects "did I say anything about" queries', () => {
      expect(isMemoryQuery("Did I say anything about the marketing plan?")).toBe(true);
      expect(isMemoryQuery("Did I mention something about Friday?")).toBe(true);
    });

    it('detects "find/search" queries', () => {
      expect(isMemoryQuery("Find what I said about the redesign")).toBe(true);
      expect(isMemoryQuery("Search my notes about the API redesign")).toBe(true);
    });

    it('detects "what was my idea" queries', () => {
      expect(isMemoryQuery("What was my idea about the landing page?")).toBe(true);
      expect(isMemoryQuery("What was that decision regarding pricing?")).toBe(true);
    });

    it('detects "remind me" queries', () => {
      expect(isMemoryQuery("Remind me what I said about the timeline")).toBe(true);
      expect(isMemoryQuery("Remind me of what we discussed")).toBe(true);
    });

    it('detects "show me" queries', () => {
      expect(isMemoryQuery("Show me my notes about the meeting")).toBe(true);
      expect(isMemoryQuery("Pull up my earlier thoughts on the design")).toBe(true);
    });

    it('returns false for non-memory queries', () => {
      expect(isMemoryQuery("Schedule a meeting for Friday")).toBe(false);
      expect(isMemoryQuery("I need to buy groceries")).toBe(false);
      expect(isMemoryQuery("Create a function for the API")).toBe(false);
      expect(isMemoryQuery("Summarize this")).toBe(false);
    });

    it('returns false for short/null input', () => {
      expect(isMemoryQuery("")).toBe(false);
      expect(isMemoryQuery(null)).toBe(false);
      expect(isMemoryQuery("hello")).toBe(false);
    });
  });

  describe('extractQueryTopic', () => {
    it('extracts topic after "about"', () => {
      expect(extractQueryTopic("What did I say about the budget?")).toBe("the budget");
      expect(extractQueryTopic("When did I mention about Sarah?")).toBe("Sarah");
    });

    it('extracts topic after "regarding"', () => {
      expect(extractQueryTopic("What was the decision regarding pricing?")).toBe("pricing");
    });

    it('extracts topic after "on"', () => {
      expect(extractQueryTopic("Show me my notes on the deployment")).toBe("the deployment");
    });

    it('strips trailing punctuation', () => {
      expect(extractQueryTopic("What did I say about the project?")).toBe("the project");
      expect(extractQueryTopic("What about the timeline!")).toBe("the timeline");
    });

    it('returns null for no topic', () => {
      expect(extractQueryTopic("What did I say")).toBeNull();
      expect(extractQueryTopic("")).toBeNull();
      expect(extractQueryTopic(null)).toBeNull();
    });
  });

  describe('memory query examples', () => {
    it('all examples are detected as memory queries', () => {
      const examples = getMemoryQueryExamples();
      for (const ex of examples) {
        expect(isMemoryQuery(ex)).toBe(true);
      }
    });

    it('has 7 examples', () => {
      expect(getMemoryQueryExamples()).toHaveLength(7);
    });
  });

  describe('pattern registry', () => {
    it('has 7 memory patterns', () => {
      expect(MEMORY_PATTERNS).toHaveLength(7);
    });
  });
});
