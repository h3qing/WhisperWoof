/**
 * The JSON Schema (Draft 2020-12) subset the recording contract v1 uses,
 * driven by the schema files copied from cardputer-assistant (../schema/).
 *
 * Errors are reported the way the contract's checker does
 * (protocol/recording/tools/check_recording.py, Python jsonschema): one
 * field path per failing keyword at the instance location ("segments[1].file",
 * "" for the root), one per missing property for `required`, one for a whole
 * failed `anyOf`. Patterns are ECMA-262 (`$` only at the end), lengths count
 * code points. A keyword outside the subset throws when the validator is
 * built, so a contract change can't be ignored silently.
 *
 * Pure: no I/O. Main-process CommonJS module.
 */

const ANNOTATIONS = ["$schema", "$id", "title", "description", "$defs", "x-knownValues"];
const ASSERTIONS = [
  "$ref",
  "type",
  "const",
  "enum",
  "pattern",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "required",
  "properties",
  "items",
  "minItems",
  "maxItems",
  "anyOf",
  "allOf",
  "if",
  "then",
];
const SUPPORTED = new Set([...ANNOTATIONS, ...ASSERTIONS]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const TYPE_CHECKS = {
  object: isObject,
  array: Array.isArray,
  string: (v) => typeof v === "string",
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => deepEqual(x, b[i]))
    );
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]))
  );
}

function formatPath(parts) {
  return parts
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
    .join("")
    .replace(/^\./, "");
}

/** Throws on any keyword outside the subset, anywhere in the schema. */
function assertSupported(schema, where) {
  if (typeof schema === "boolean") return;
  if (!isObject(schema)) throw new Error(`${where}: a schema must be an object`);
  for (const [key, value] of Object.entries(schema)) {
    if (!SUPPORTED.has(key) && !key.startsWith("x-"))
      throw new Error(`${where}: unsupported keyword ${key}`);
    if (key === "properties" || key === "$defs") {
      for (const [name, sub] of Object.entries(value))
        assertSupported(sub, `${where}/${key}/${name}`);
    } else if (key === "anyOf" || key === "allOf") {
      value.forEach((sub, i) => assertSupported(sub, `${where}/${key}/${i}`));
    } else if (key === "items" || key === "if" || key === "then") {
      assertSupported(value, `${where}/${key}`);
    }
  }
}

function fileOf(id) {
  return String(id || "")
    .split("/")
    .pop();
}

function makeResolver(documents) {
  const byFile = new Map(
    Object.entries(documents).map(([name, doc]) => [fileOf(doc.$id) || name, doc])
  );
  return (ref, currentFile) => {
    const [file, pointer = ""] = ref.split("#");
    const target = file ? fileOf(file) : currentFile;
    const doc = byFile.get(target);
    if (!doc) throw new Error(`Unknown schema ${ref}`);
    const node = pointer
      .split("/")
      .filter(Boolean)
      .reduce(
        (n, token) => (n == null ? n : n[token.replace(/~1/g, "/").replace(/~0/g, "~")]),
        doc
      );
    if (node === undefined) throw new Error(`Unresolvable $ref ${ref}`);
    return { schema: node, file: target };
  };
}

const STRING_RULES = [
  ["pattern", (s, v) => !new RegExp(s.pattern, "u").test(v)],
  ["minLength", (s, v) => [...v].length < s.minLength],
  ["maxLength", (s, v) => [...v].length > s.maxLength],
];
const NUMBER_RULES = [
  ["minimum", (s, v) => v < s.minimum],
  ["maximum", (s, v) => v > s.maximum],
];
const ARRAY_RULES = [
  ["minItems", (s, v) => v.length < s.minItems],
  ["maxItems", (s, v) => v.length > s.maxItems],
];

function failing(rules, schema, value) {
  return rules.filter(([key, bad]) => key in schema && bad(schema, value)).map(([key]) => key);
}

function scalarErrors(schema, value) {
  if (typeof value === "string") return failing(STRING_RULES, schema, value);
  if (typeof value === "number") return failing(NUMBER_RULES, schema, value);
  if (Array.isArray(value)) return failing(ARRAY_RULES, schema, value);
  return [];
}

function keywordErrors(schema, value) {
  const failed = [];
  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => TYPE_CHECKS[t]?.(value))) failed.push("type");
  }
  if ("const" in schema && !deepEqual(schema.const, value)) failed.push("const");
  if ("enum" in schema && !schema.enum.some((option) => deepEqual(option, value)))
    failed.push("enum");
  return [...failed, ...scalarErrors(schema, value)];
}

/**
 * documents: { name: schema }. → validate(name, instance) → sorted, unique
 * field paths of every error ([] when valid).
 */
function createValidator(documents) {
  for (const [name, doc] of Object.entries(documents)) assertSupported(doc, name);
  const resolve = makeResolver(documents);

  function check(schema, value, at, file) {
    if (schema === true) return [];
    if (schema === false) return [at];
    const here = keywordErrors(schema, value).map(() => at);
    const nested = [];
    if ("$ref" in schema) {
      const target = resolve(schema.$ref, file);
      nested.push(...check(target.schema, value, at, target.file));
    }
    if (isObject(value)) nested.push(...objectErrors(schema, value, at, file));
    if (Array.isArray(value) && "items" in schema) {
      value.forEach((item, i) => nested.push(...check(schema.items, item, [...at, i], file)));
    }
    if ("anyOf" in schema && !schema.anyOf.some((s) => check(s, value, at, file).length === 0))
      nested.push(at);
    for (const sub of schema.allOf || []) nested.push(...check(sub, value, at, file));
    if ("if" in schema && "then" in schema && check(schema.if, value, at, file).length === 0) {
      nested.push(...check(schema.then, value, at, file));
    }
    return [...here, ...nested];
  }

  function objectErrors(schema, value, at, file) {
    const missing = (schema.required || [])
      .filter((key) => !(key in value))
      .map((key) => [...at, key]);
    const props = Object.entries(schema.properties || {})
      .filter(([key]) => key in value)
      .flatMap(([key, sub]) => check(sub, value[key], [...at, key], file));
    return [...missing, ...props];
  }

  return (name, instance) => {
    const doc = documents[name];
    if (!doc) throw new Error(`Unknown schema ${name}`);
    const paths = check(doc, instance, [], fileOf(doc.$id) || name).map(formatPath);
    return [...new Set(paths)].sort();
  };
}

module.exports = { createValidator, deepEqual, formatPath };
