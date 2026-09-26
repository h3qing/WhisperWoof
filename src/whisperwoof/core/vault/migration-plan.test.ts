import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const plan = require("../../bridge/vault/migration-plan-pure.js");

describe("sqliteState", () => {
  it("tells plain SQLite from encrypted pages", () => {
    expect(plan.sqliteState(Buffer.from("SQLite format 3\0rest-of-page"))).toBe("plain");
    expect(plan.sqliteState(Buffer.from([0x9a, 0x11, 0x02, 0x7f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("encrypted");
    expect(plan.sqliteState(null)).toBe("missing");
  });

  it("calls an empty file plain (SQLite hasn't written a page yet)", () => {
    expect(plan.sqliteState(Buffer.alloc(0))).toBe("plain");
  });
});

describe("planDatabaseStep — turning encryption on", () => {
  const step = (facts: object) => plan.planDatabaseStep("enable", facts);

  it("converts a plain database", () => {
    expect(step({ main: "plain", work: false, old: false })).toBe("convert");
  });

  it("starts over when a crash left a half-made copy", () => {
    expect(step({ main: "plain", work: true, old: false })).toBe("convert");
  });

  it("finishes the swap when the crash hit between the two renames", () => {
    expect(step({ main: "missing", work: true, old: true })).toBe("finish-swap");
  });

  it("puts the original back if the copy is gone after the first rename", () => {
    expect(step({ main: "missing", work: false, old: true })).toBe("restore-old");
  });

  it("deletes the plain original once the encrypted one is in place", () => {
    expect(step({ main: "encrypted", work: false, old: true })).toBe("cleanup");
  });

  it("is done when the database is encrypted (or doesn't exist yet)", () => {
    expect(step({ main: "encrypted", work: false, old: false })).toBe("done");
    expect(step({ main: "encrypted", work: true, old: false })).toBe("done");
    expect(step({ main: "missing", work: false, old: false })).toBe("done");
  });
});

describe("planDatabaseStep — turning encryption off", () => {
  const step = (facts: object) => plan.planDatabaseStep("disable", facts);

  it("mirrors the enable rules", () => {
    expect(step({ main: "encrypted", work: false, old: false })).toBe("convert");
    expect(step({ main: "missing", work: true, old: true })).toBe("finish-swap");
    expect(step({ main: "plain", work: false, old: true })).toBe("cleanup");
    expect(step({ main: "plain", work: false, old: false })).toBe("done");
  });
});

describe("planFileStep", () => {
  it("enable: seals plain files, verifies before deleting, ignores done ones", () => {
    expect(plan.planFileStep("enable", { plain: true, sealed: false })).toBe("convert");
    expect(plan.planFileStep("enable", { plain: true, sealed: true })).toBe("verify-and-remove-source");
    expect(plan.planFileStep("enable", { plain: false, sealed: true })).toBe("done");
    expect(plan.planFileStep("enable", { plain: false, sealed: false })).toBe("done");
  });

  it("disable: the same rules the other way round", () => {
    expect(plan.planFileStep("disable", { plain: false, sealed: true })).toBe("convert");
    expect(plan.planFileStep("disable", { plain: true, sealed: true })).toBe("verify-and-remove-source");
    expect(plan.planFileStep("disable", { plain: true, sealed: false })).toBe("done");
  });

  it("rejects an unknown direction", () => {
    expect(() => plan.planFileStep("sideways", { plain: true, sealed: false })).toThrow();
  });
});

describe("journal", () => {
  it("walks db → files → cleanup → done", () => {
    let j = plan.startJournal("enable", new Date("2026-09-25T10:00:00Z"));
    expect(j.phase).toBe("db");
    const seen = [j.phase];
    while (j.phase !== "done") {
      j = plan.advanceJournal(j);
      seen.push(j.phase);
    }
    expect(seen).toEqual(["db", "files", "cleanup", "done"]);
  });

  it("turning encryption off decrypts files before the database", () => {
    // If a file fails, the database is still encrypted and matches the vault.
    let j = plan.startJournal("disable", new Date("2026-09-25T10:00:00Z"));
    const seen = [j.phase];
    while (j.phase !== "done") {
      j = plan.advanceJournal(j);
      seen.push(j.phase);
    }
    expect(seen).toEqual(["files", "db", "cleanup", "done"]);
  });

  it("accepts a rotation journal (new recovery phrase)", () => {
    const j = plan.startJournal("rotate", new Date());
    expect(plan.parseJournal(JSON.parse(JSON.stringify(j))).direction).toBe("rotate");
    expect(() => plan.planFileStep("rotate", { plain: true, sealed: false })).toThrow();
  });

  it("parses a saved journal and rejects a damaged one", () => {
    const j = plan.startJournal("disable", new Date());
    expect(plan.parseJournal(JSON.parse(JSON.stringify(j)))).toEqual(j);
    expect(() => plan.parseJournal({ ...j, phase: "weird" })).toThrow();
    expect(() => plan.parseJournal({ ...j, direction: "up" })).toThrow();
  });
});
