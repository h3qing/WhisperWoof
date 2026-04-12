/**
 * Pure logic shared by snippet-hotkeys.js (runtime) and snippet-hotkeys.test.ts.
 *
 * Kept as CommonJS so the Electron main process can require() it without a
 * TypeScript build step, and vitest can import it from .test.ts files.
 *
 * Side-effect-free. Never touches a database, electron, or the file system.
 */

/**
 * Map a bf_snippets row (snake_case from SQLite) to the camelCase shape
 * used by the rest of the app.
 *
 * @param {object} row - Raw row from `SELECT * FROM bf_snippets`.
 * @returns {object} Camel-cased snippet with use_count defaulted to 0.
 */
function mapSnippetRow(row) {
  return Object.freeze({
    id: row.id,
    content: row.content,
    title: row.title,
    boardId: row.board_id,
    hotkey: row.hotkey,
    useCount: row.use_count ?? 0,
  });
}

module.exports = {
  mapSnippetRow,
};
