/**
 * Tests for Language Detection — multi-language support.
 *
 * Imports the real `detectLanguage`, `SCRIPT_PATTERNS`, and `WORD_PATTERNS`
 * from bridge/language-detect.js so regressions in the script/word-frequency
 * heuristics are caught. The source only requires debugLogger.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  detectLanguage,
  getLanguagePolishSuffix,
  getSupportedLanguages,
  LANGUAGE_NAMES,
} from "../../bridge/language-detect";

describe("detectLanguage — script-based detection", () => {
  it("detects Japanese (hiragana/katakana)", () => {
    const result = detectLanguage("これはテストです。日本語のテキストです。");
    expect(result.lang).toBe("ja");
    expect(result.name).toBe("Japanese");
    expect(result.confidence).toBe("high");
  });

  it("detects Korean (Hangul)", () => {
    const result = detectLanguage("이것은 한국어 텍스트입니다. 테스트합니다.");
    expect(result.lang).toBe("ko");
    expect(result.confidence).toBe("high");
  });

  it("detects Chinese (CJK)", () => {
    const result = detectLanguage("这是一个中文文本测试。你好世界。");
    expect(result.lang).toBe("zh");
    expect(result.confidence).toBe("high");
  });

  it("detects Arabic", () => {
    const result = detectLanguage("هذا نص باللغة العربية للاختبار");
    expect(result.lang).toBe("ar");
    expect(result.confidence).toBe("high");
  });

  it("detects Russian (Cyrillic)", () => {
    const result = detectLanguage("Это текст на русском языке для тестирования");
    expect(result.lang).toBe("ru");
    expect(result.confidence).toBe("high");
  });

  it("detects Hindi (Devanagari)", () => {
    const result = detectLanguage("यह हिंदी में एक परीक्षण पाठ है");
    expect(result.lang).toBe("hi");
    expect(result.confidence).toBe("high");
  });

  it("detects Thai", () => {
    const result = detectLanguage("นี่คือข้อความภาษาไทยสำหรับการทดสอบ");
    expect(result.lang).toBe("th");
    expect(result.confidence).toBe("high");
  });
});

describe("detectLanguage — word-frequency detection (Latin scripts)", () => {
  it("detects Spanish", () => {
    const result = detectLanguage(
      "Esta es una prueba del sistema para detectar que idioma estamos usando con más palabras",
    );
    expect(result.lang).toBe("es");
  });

  it("detects French", () => {
    const result = detectLanguage(
      "Les résultats sont dans une base de données pour les utilisateurs qui sont sur cette plateforme",
    );
    expect(result.lang).toBe("fr");
  });

  it("detects German", () => {
    const result = detectLanguage(
      "Der Mann ist ein guter Freund und die Frau ist auch eine nette Person für das Team",
    );
    expect(result.lang).toBe("de");
  });

  it("detects Italian", () => {
    const result = detectLanguage(
      "Questo non è un problema per una persona che viene anche dalla città della regione",
    );
    expect(result.lang).toBe("it");
  });
});

describe("detectLanguage — English default / short-circuit", () => {
  it("defaults to English for English text", () => {
    const result = detectLanguage("I need to buy groceries and pick up the kids from school today");
    expect(result.lang).toBe("en");
  });

  it("defaults to English for short text (< 5 chars)", () => {
    const result = detectLanguage("hi");
    expect(result.lang).toBe("en");
    expect(result.confidence).toBe("default");
  });

  it("defaults to English for null", () => {
    const result = detectLanguage(null);
    expect(result.lang).toBe("en");
    expect(result.confidence).toBe("default");
  });

  it("defaults to English for empty string", () => {
    const result = detectLanguage("");
    expect(result.lang).toBe("en");
    expect(result.confidence).toBe("default");
  });
});

describe("detectLanguage — mixed and edge cases", () => {
  it("handles mixed-script text (majority script wins)", () => {
    const result = detectLanguage("これはtestです。日本語のtextです。テストrunning。");
    expect(result.lang).toBe("ja");
  });

  it("handles numbers and punctuation gracefully (defaults to English)", () => {
    const result = detectLanguage("12345 !@#$% 67890");
    expect(result.lang).toBe("en");
  });
});

describe("getLanguagePolishSuffix", () => {
  it("returns empty string for English", () => {
    expect(getLanguagePolishSuffix("en")).toBe("");
  });

  it("returns empty string for null / undefined", () => {
    expect(getLanguagePolishSuffix(null)).toBe("");
    expect(getLanguagePolishSuffix(undefined)).toBe("");
  });

  it("names the detected language so the polish prompt stays in-language", () => {
    const suffix = getLanguagePolishSuffix("ja");
    expect(suffix).toContain("Japanese");
    expect(suffix).toContain("Do NOT translate");
  });

  it("falls back to the raw code if language name is unknown", () => {
    expect(getLanguagePolishSuffix("xx")).toContain("xx");
  });
});

describe("getSupportedLanguages", () => {
  it("lists all languages in LANGUAGE_NAMES with {code, name}", () => {
    const list = getSupportedLanguages();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((l: { code: string; name: string }) => !!l.code && !!l.name)).toBe(true);
  });

  it("includes English and at least one non-Latin script language", () => {
    const list = getSupportedLanguages() as { code: string; name: string }[];
    const codes = list.map((l) => l.code);
    expect(codes).toContain("en");
    expect(codes).toContain("ja");
  });
});

describe("LANGUAGE_NAMES registry", () => {
  it("maps 'en' to 'English'", () => {
    expect(LANGUAGE_NAMES.en).toBe("English");
  });

  it("covers both script-based and word-frequency languages", () => {
    expect(LANGUAGE_NAMES.ja).toBe("Japanese");
    expect(LANGUAGE_NAMES.es).toBe("Spanish");
    expect(LANGUAGE_NAMES.fr).toBe("French");
  });
});
