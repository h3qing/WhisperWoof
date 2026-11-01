/**
 * Cleanup (polish) side of the rating page: the blind choices per clip and the
 * scores from what the owner picked. Outputs come from run_polish.js
 * (<data>/polish/<name>.json); picks are kept in <data>/polish-ratings.json.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ratingsFile = (data) => path.join(data, "polish-ratings.json");
const readPolishRatings = (data) => (fs.existsSync(ratingsFile(data)) ? JSON.parse(fs.readFileSync(ratingsFile(data), "utf8")) : {});

function loadPolish(data) {
  const dir = path.join(data, "polish");
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    : [];
}

/** Per clip: the transcript that was cleaned up and each distinct cleanup, in an order that says nothing about the model. */
function polishSession(data, manifest) {
  const models = loadPolish(data);
  const clips = manifest.clips
    .map((clip) => {
      const groups = new Map();
      for (const m of models) {
        const out = m.clips[clip.id];
        if (!out) continue;
        const key = out.text.replace(/\s+/g, " ").trim();
        const group = groups.get(key) || { text: out.text.trim(), models: [] };
        groups.set(key, { ...group, models: [...group.models, m.name] });
      }
      const order = (text) => crypto.createHash("sha1").update(`${clip.id}:${text}`).digest("hex");
      const options = [...groups.values()].sort((a, b) => order(a.text).localeCompare(order(b.text)));
      return { id: clip.id, durationMs: clip.durationMs, timestamp: clip.timestamp, options, unanimous: options.length === 1 };
    })
    .filter((c) => c.options.length);
  const inputs = Object.fromEntries(
    models.length ? Object.entries(JSON.parse(fs.readFileSync(path.join(data, "hyps", `${models[0].input}.json`), "utf8")).clips).map(([id, h]) => [id, h.text]) : []
  );
  const withInput = clips.map((c) => ({ ...c, input: inputs[c.id] || "" })).filter((c) => /[\p{L}\p{N}]/u.test(c.input));
  return { clips: withInput, ratings: readPolishRatings(data), input: models[0]?.input || null };
}

function savePolishRating(data, manifest, body) {
  const id = String(body.clipId);
  if (!manifest.clips.some((c) => String(c.id) === id)) throw new Error("unknown clip");
  const strings = (xs) => (Array.isArray(xs) ? xs.map(String).slice(0, 50) : []);
  const next = { ...readPolishRatings(data), [id]: { best: strings(body.best), meaningChanged: strings(body.meaningChanged), at: new Date().toISOString() } };
  fs.writeFileSync(ratingsFile(data), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

function scorePolish(data) {
  const models = loadPolish(data);
  const ratings = readPolishRatings(data);
  const rows = models.map((m) => {
    const rated = Object.keys(ratings).filter((id) => m.clips[id]);
    const outs = Object.values(m.clips);
    return {
      name: m.name,
      model: m.model,
      rated: rated.length,
      bestRate: rated.length ? rated.filter((id) => ratings[id].best.includes(m.name)).length / rated.length : null,
      meaningChanged: rated.filter((id) => ratings[id].meaningChanged.includes(m.name)).length,
      translated: outs.filter((o) => o.translated).length,
      leaked: outs.filter((o) => o.leaked).length,
      clips: outs.length,
      msP50: median(outs.map((o) => o.ms)),
    };
  });
  return { rated: Object.keys(ratings).length, input: models[0]?.input || null, models: rows.sort((a, b) => (b.bestRate ?? -1) - (a.bestRate ?? -1)) };
}

module.exports = { polishSession, savePolishRating, scorePolish };
