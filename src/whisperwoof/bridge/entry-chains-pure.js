/**
 * Entry Chains — pure traversal logic (no electron/db/debugLogger)
 *
 * Extracted from entry-chains.js so tests can import without
 * triggering Electron/DB side effects at load time.
 *
 * All functions accept a lookup object with:
 *   findParent(childId) → parentId | null
 *   findChildren(parentId) → [childId, ...]
 */

function isAncestor(potentialAncestor, entryId, lookup) {
  let current = entryId;
  const visited = new Set();

  while (current) {
    if (current === potentialAncestor) return true;
    if (visited.has(current)) return false;
    visited.add(current);

    current = lookup.findParent(current);
  }

  return false;
}

function getChainRoot(entryId, lookup) {
  let current = entryId;
  const visited = new Set();

  while (true) {
    const parent = lookup.findParent(current);
    if (!parent) return current;
    if (visited.has(parent)) return current;
    visited.add(current);
    current = parent;
  }
}

function getChainEntries(entryId, lookup) {
  const rootId = getChainRoot(entryId, lookup);

  const entries = [];
  const queue = [rootId];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    entries.push(current);

    const children = lookup.findChildren(current);
    for (const child of children) {
      queue.push(child);
    }
  }

  return entries;
}

function getParent(entryId, lookup) {
  return lookup.findParent(entryId);
}

function getChildren(entryId, lookup) {
  return lookup.findChildren(entryId);
}

module.exports = {
  isAncestor,
  getChainRoot,
  getChainEntries,
  getParent,
  getChildren,
};
