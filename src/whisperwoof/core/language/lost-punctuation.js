/**
 * Repair "�" (U+FFFD) that STT engines leave where a character's bytes broke.
 *
 * Whisper's tokenizer has no token for the full-width ，？！：； (EF BC xx):
 * the model spells each one as byte tokens, and Whisper Turbo sometimes
 * drops a byte. whisper-server replaces the invalid UTF-8 with U+FFFD, so a
 * dictation arrives as "方便查询�看这个数据". 。 and 、 are single tokens and
 * never break, so a mark lost between two words in Chinese text was almost
 * always the comma. Anywhere else nothing sensible can be recovered and the
 * mark is dropped, keeping the words on either side apart.
 *
 * Main-process module (CommonJS) so whisper.js and parakeetWsResult.js can
 * repair a transcript before anything else reads it.
 */

// A run of replacement characters, with the horizontal space around it.
const LOST_RUN = /[ \t\u3000]*\uFFFD(?:[ \t\u3000]*\uFFFD)*[ \t\u3000]*/g;
// Han, kana, Hangul: text whose clauses are joined with full-width marks.
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /[ \t\u3000]/;

function repairLostPunctuation(text) {
  if (typeof text !== "string" || !text.includes("\uFFFD")) return text;
  return text
    .replace(LOST_RUN, (run, offset, whole) => {
      const before = whole[offset - 1] ?? "";
      const after = whole[offset + run.length] ?? "";
      if (CJK_CHAR.test(before) || CJK_CHAR.test(after)) {
        return WORD_CHAR.test(before) && WORD_CHAR.test(after) ? "，" : "";
      }
      return before && after && SPACE.test(run) ? " " : "";
    })
    .trim();
}

module.exports = { repairLostPunctuation };
