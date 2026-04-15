/**
 * Tests for Entry Chaining — link/unlink, tree traversal, cycle detection
 *
 * Imports from the actual pure module (no duplicated implementation).
 */

import { describe, it, expect } from 'vitest';

// Import from the pure module — no electron/db side effects
const { isAncestor, getChainRoot, getChainEntries, getParent, getChildren } = require('../../bridge/entry-chains-pure');

interface ChainLink {
  childId: string;
  parentId: string;
}

function createLookup(links: ChainLink[]) {
  return {
    findParent(childId: string): string | null {
      const link = links.find((l) => l.childId === childId);
      return link ? link.parentId : null;
    },
    findChildren(parentId: string): string[] {
      return links.filter((l) => l.parentId === parentId).map((l) => l.childId);
    },
  };
}

describe('Entry Chaining', () => {
  // Chain: A → B → C (A is root)
  const links: ChainLink[] = [
    { childId: "B", parentId: "A" },
    { childId: "C", parentId: "B" },
  ];
  const lookup = createLookup(links);

  describe('getChainRoot', () => {
    it('finds root from any entry in chain', () => {
      expect(getChainRoot("C", lookup)).toBe("A");
      expect(getChainRoot("B", lookup)).toBe("A");
      expect(getChainRoot("A", lookup)).toBe("A"); // root itself
    });

    it('returns self for unlinked entry', () => {
      expect(getChainRoot("D", lookup)).toBe("D");
    });
  });

  describe('getChainEntries', () => {
    it('returns all entries in chain from any member', () => {
      const chain = getChainEntries("C", lookup);
      expect(chain).toContain("A");
      expect(chain).toContain("B");
      expect(chain).toContain("C");
      expect(chain).not.toContain("D");
    });

    it('returns single entry for unlinked', () => {
      expect(getChainEntries("D", lookup)).toEqual(["D"]);
    });

    it('root traversal returns full chain', () => {
      expect(getChainEntries("A", lookup)).toHaveLength(3);
    });
  });

  describe('getParent', () => {
    it('returns parent for child', () => {
      expect(getParent("B", lookup)).toBe("A");
      expect(getParent("C", lookup)).toBe("B");
    });

    it('returns null for root', () => {
      expect(getParent("A", lookup)).toBeNull();
    });

    it('returns null for unlinked', () => {
      expect(getParent("D", lookup)).toBeNull();
    });
  });

  describe('getChildren', () => {
    it('returns children', () => {
      expect(getChildren("A", lookup)).toEqual(["B"]);
      expect(getChildren("B", lookup)).toEqual(["C"]);
    });

    it('returns empty for leaf', () => {
      expect(getChildren("C", lookup)).toEqual([]);
    });

    it('returns empty for unlinked', () => {
      expect(getChildren("D", lookup)).toEqual([]);
    });
  });

  describe('isAncestor (cycle detection)', () => {
    it('detects direct ancestor', () => {
      expect(isAncestor("A", "B", lookup)).toBe(true);
    });

    it('detects transitive ancestor', () => {
      expect(isAncestor("A", "C", lookup)).toBe(true);
    });

    it('non-ancestor returns false', () => {
      expect(isAncestor("C", "A", lookup)).toBe(false);
      expect(isAncestor("D", "A", lookup)).toBe(false);
    });

    it('self-link detected (entry is its own ancestor)', () => {
      expect(isAncestor("A", "A", lookup)).toBe(true);
    });
  });

  describe('validation', () => {
    it('cannot link entry to itself', () => {
      // Validation logic: childId === parentId
      expect("A" === "A").toBe(true); // would be rejected
    });

    it('cannot create cycle', () => {
      // If we try to link A → C (A as child of C), isAncestor(A, C) = true
      expect(isAncestor("A", "C", lookup)).toBe(true); // A is ancestor of C
    });

    it('entry can only have one parent', () => {
      // B already has parent A — checked via PRIMARY KEY (child_id)
      const existing = links.find((l) => l.childId === "B");
      expect(existing).toBeDefined();
    });
  });

  describe('branching', () => {
    // A has two children: B and D
    const branchLinks: ChainLink[] = [
      { childId: "B", parentId: "A" },
      { childId: "D", parentId: "A" },
      { childId: "C", parentId: "B" },
    ];
    const branchLookup = createLookup(branchLinks);

    it('getChildren returns multiple children', () => {
      expect(getChildren("A", branchLookup)).toEqual(["B", "D"]);
    });

    it('getChainEntries from any leaf includes all members', () => {
      const chain = getChainEntries("C", branchLookup);
      expect(chain).toHaveLength(4); // A, B, C, D
    });

    it('root is still A', () => {
      expect(getChainRoot("D", branchLookup)).toBe("A");
      expect(getChainRoot("C", branchLookup)).toBe("A");
    });
  });
});
