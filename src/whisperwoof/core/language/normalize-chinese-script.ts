/**
 * Typed re-export of the shared Chinese script normalizer.
 *
 * The implementation lives in bridge/chinese-script.js (CommonJS) because the
 * Electron main process needs it too — see that file for why the conversion
 * exists and why only Traditional -> Simplified ships.
 */
import * as impl from "../../bridge/chinese-script.js";

export type ChineseScript = "simplified" | "off";

export const normalizeChineseScript: (text: string, target?: ChineseScript) => string =
  impl.normalizeChineseScript;

export const scriptForLanguage: (language: string | null | undefined) => ChineseScript =
  impl.scriptForLanguage;
