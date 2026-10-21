/**
 * Recording file contract v1 (cardputer-assistant protocol/recording/v1):
 * a reader's verdict on one file, as check_recording.validate gives it.
 *
 *   1. not a JSON object                     -> E_INVALID (root)
 *   2. v is not the integer 1                -> E_VERSION v (nothing else is read)
 *   3. result.json over 64 KiB               -> E_INVALID (size)
 *   4. schema errors, then manifest index rules -> E_INVALID <paths>
 *
 * Unknown fields never cause a rejection. The schemas are the copies in
 * ./schema (see fixtures/SOURCE). Pure: the schemas load once with the module.
 */

const { createValidator } = require("./contract-schema");

const SCHEMAS = Object.freeze({
  common: require("./schema/common.schema.json"),
  manifest: require("./schema/manifest.schema.json"),
  status: require("./schema/status.schema.json"),
  transcript: require("./schema/transcript.schema.json"),
  result: require("./schema/result.schema.json"),
});
const DOCS = Object.freeze(["manifest", "status", "transcript", "result"]);
const MAX_BYTES = Object.freeze({ result: 65536 });

const validateSchema = createValidator(SCHEMAS);

function isV1(data) {
  return typeof data.v === "number" && Number.isInteger(data.v) && data.v === 1;
}

function byteSize(data) {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

const segFileName = (i) => `seg-${String(i).padStart(3, "0")}.wav`;

function notAscending(values, label) {
  return values.flatMap((v, k) => (k > 0 && v <= values[k - 1] ? [label(k)] : []));
}

/** Manifest rules beyond the schema (contract README); assumes a schema-valid manifest. */
function indexProblems(manifest) {
  const { segments, gaps } = manifest;
  const indices = segments.map((s) => s.i);
  const covered = new Set([...indices, ...gaps]);
  const max = Math.max(...covered);
  const contiguous = covered.size === max + 1;
  return [
    ...notAscending(indices, (k) => `segments[${k}].i`),
    ...notAscending(gaps, (k) => `gaps[${k}]`),
    ...gaps.flatMap((g, k) => (indices.includes(g) ? [`gaps[${k}]`] : [])),
    ...segments.flatMap((s, k) => (s.file !== segFileName(s.i) ? [`segments[${k}].file`] : [])),
    ...segments.flatMap((s, k) => (s.bytes !== 44 + 2 * s.samples ? [`segments[${k}].bytes`] : [])),
    ...(contiguous ? [] : ["gaps"]),
  ];
}

/**
 * → { code: "ok" | "E_INVALID" | "E_VERSION", fields: string[] }.
 * `sizeBytes`: the file's size on disk (result.json), else its compact JSON.
 */
function validateDoc(doc, data, { sizeBytes } = {}) {
  if (!DOCS.includes(doc)) throw new Error(`Unknown contract document: ${doc}`);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { code: "E_INVALID", fields: ["(root)"] };
  }
  if (!isV1(data)) return { code: "E_VERSION", fields: ["v"] };
  const limit = MAX_BYTES[doc];
  if (limit && (sizeBytes ?? byteSize(data)) > limit)
    return { code: "E_INVALID", fields: ["(size)"] };
  const schemaFields = validateSchema(doc, data);
  const fields = schemaFields.length || doc !== "manifest" ? schemaFields : indexProblems(data);
  return fields.length
    ? { code: "E_INVALID", fields: [...new Set(fields)].sort() }
    : { code: "ok", fields: [] };
}

module.exports = { validateDoc, segFileName, DOCS, SCHEMAS };
