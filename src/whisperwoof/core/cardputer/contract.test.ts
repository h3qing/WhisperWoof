/**
 * The recording file contract v1 shared with cardputer-assistant (cpad):
 * the copied schemas and vectors are byte-identical to the ones named in
 * fixtures/SOURCE, and contract.js gives every vector exactly the verdict
 * the contract's own checker gives it.
 */
import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const contract = require("./contract.js");
const { createValidator } = require("./contract-schema.js");

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(HERE, "fixtures");

const sha256 = (file: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** "digest  name" lines → { name: digest } */
function digestLines(text: string) {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => /^[0-9a-f]{64}\s/.test(l))
      .map((l) => {
        const [digest, name] = l.split(/\s+/);
        return [name.replace(/^\*/, ""), digest];
      })
  );
}

type Vector = {
  doc: string;
  name: string;
  data: unknown;
  reason?: { code: string; field: string };
};

function vectors(kind: "valid" | "invalid") {
  const dir = path.join(FIXTURES, "vectors", kind);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      file: f,
      ...(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Vector),
    }));
}

describe("copied contract files", () => {
  const source = fs.readFileSync(path.join(FIXTURES, "SOURCE"), "utf8");
  const listed = digestLines(fs.readFileSync(path.join(FIXTURES, "VECTORS.sha256"), "utf8"));

  it("lists every vector in VECTORS.sha256 with its digest, and nothing else", () => {
    const actual = Object.fromEntries(
      (["valid", "invalid"] as const).flatMap((kind) =>
        vectors(kind).map((v) => [
          `vectors/${kind}/${v.file}`,
          sha256(path.join(FIXTURES, "vectors", kind, v.file)),
        ])
      )
    );
    expect(actual).toEqual(listed);
    expect(Object.keys(listed).length).toBe(31);
  });

  it("has the VECTORS.sha256 and the schemas SOURCE names", () => {
    const named = digestLines(source);
    expect(named["VECTORS.sha256"]).toBe(sha256(path.join(FIXTURES, "VECTORS.sha256")));
    for (const doc of ["common", "manifest", "result", "status", "transcript"]) {
      const file = `schema/${doc}.schema.json`;
      expect(named[file], file).toBe(sha256(path.join(HERE, file)));
    }
    expect(source).toMatch(/commit:\s+[0-9a-f]{40}/);
  });
});

describe("contract verdicts", () => {
  it.each(vectors("valid").map((v) => [v.file, v]))("accepts %s", (_file, v) => {
    expect(contract.validateDoc(v.doc, v.data)).toEqual({ code: "ok", fields: [] });
  });

  it.each(vectors("invalid").map((v) => [v.file, v]))(
    "rejects %s with its declared reason",
    (_file, v) => {
      expect(contract.validateDoc(v.doc, v.data)).toEqual({
        code: v.reason!.code,
        fields: [v.reason!.field],
      });
    }
  );

  it("covers the cases WhisperWoof must refuse", () => {
    const reasons = vectors("invalid").map((v) => `${v.doc}:${v.reason!.code}:${v.reason!.field}`);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "manifest:E_INVALID:segments[0].file", // ../ and absolute paths
        "manifest:E_INVALID:session",
        "manifest:E_INVALID:segments[0].sha256",
        "manifest:E_INVALID:gaps",
        "manifest:E_VERSION:v",
        "result:E_VERSION:v",
      ])
    );
  });

  const meeting = () =>
    structuredClone(vectors("valid").find((v) => v.file === "manifest_meeting.json")!.data) as any;

  it("ignores unknown fields anywhere, and unknown mark kinds", () => {
    const m = meeting();
    m.future_field = { anything: [1, 2] };
    m.segments[0].future = true;
    m.marks = [...m.marks, { t_ms: 1, k: "todo" }];
    expect(contract.validateDoc("manifest", m)).toEqual({ code: "ok", fields: [] });
  });

  it("rejects anything but the integer 1 as v, before reading the rest", () => {
    for (const v of [undefined, 2, "1", 1.5, true]) {
      const m = { ...meeting(), v, session: "nope" };
      expect(contract.validateDoc("manifest", m)).toEqual({ code: "E_VERSION", fields: ["v"] });
    }
    expect(contract.validateDoc("manifest", [])).toEqual({ code: "E_INVALID", fields: ["(root)"] });
    expect(contract.validateDoc("manifest", null)).toEqual({
      code: "E_INVALID",
      fields: ["(root)"],
    });
  });

  it("reads patterns as ECMA-262: $ is the end of the string", () => {
    const m = meeting();
    m.segments[0].file = "seg-000.wav\n";
    expect(contract.validateDoc("manifest", m).fields).toContain("segments[0].file");
  });

  it("reports each missing required field, and keeps the index rules", () => {
    const m = meeting();
    delete m.kind;
    delete m.device.fw;
    expect(contract.validateDoc("manifest", m).fields).toEqual(["device.fw", "kind"]);
    const n = meeting();
    n.segments[0].bytes += 2;
    expect(contract.validateDoc("manifest", n).fields).toEqual(["segments[0].bytes"]);
  });

  it("counts text length in code points, like the contract", () => {
    const r = structuredClone(
      vectors("valid").find((v) => v.file === "result_meeting_summary.json")!.data
    ) as any;
    r.title = "😀".repeat(80);
    expect(contract.validateDoc("result", r).code).toBe("ok");
    r.title = "😀".repeat(81);
    expect(contract.validateDoc("result", r).fields).toEqual(["title"]);
  });

  it("refuses a result.json over 64 KiB", () => {
    const r = structuredClone(
      vectors("valid").find((v) => v.file === "result_unknown_field.json")!.data
    ) as any;
    r.padding = "x".repeat(70_000);
    expect(contract.validateDoc("result", r)).toEqual({ code: "E_INVALID", fields: ["(size)"] });
  });

  it("knows only the four documents", () => {
    expect(() => contract.validateDoc("summary", {})).toThrow();
  });
});

describe("schema subset", () => {
  it("refuses a schema keyword it does not implement, so a contract change can't pass silently", () => {
    expect(() => createValidator({ "a.json": { $id: "x/a.json", oneOf: [] } })).toThrow(/oneOf/);
  });

  it("checks types, consts, enums, bounds and nested refs", () => {
    const validate = createValidator({
      "a.json": {
        $id: "https://x.invalid/a.json",
        type: "object",
        properties: {
          n: { type: "integer", minimum: 1, maximum: 3 },
          s: { $ref: "#/$defs/s" },
          t: { type: ["string", "null"] },
          e: { enum: ["x", { y: [1] }] },
          c: { const: false },
          list: { type: "array", minItems: 1, maxItems: 2, items: { $ref: "b.json#/$defs/b" } },
          any: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        $defs: { s: { type: "string", minLength: 2, pattern: "^a" } },
      },
      "b.json": { $id: "https://x.invalid/b.json", $defs: { b: { type: "boolean" } } },
    });
    const good = { n: 2, s: "ab", t: null, e: { y: [1] }, c: false, list: [true], any: 1.5 };
    expect(validate("a.json", good)).toEqual([]);
    const bad = { n: 2.5, s: "b", t: 1, e: "z", c: 0, list: [1, true, false], any: "no" };
    expect(validate("a.json", bad).sort()).toEqual([
      "any",
      "c",
      "e",
      "list",
      "list[0]",
      "n",
      "s",
      "t",
    ]);
  });
});
