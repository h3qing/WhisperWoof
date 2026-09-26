/**
 * Settings export/import with encryption on: Memory and style examples are
 * sealed, so export reads them through the vault and import writes them
 * sealed — never a plain copy next to the sealed one.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const FAST = { N: 1024, r: 8, p: 1 };
let userData = "";

function boot() {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => userData, isReady: () => false }, dialog: {} },
  } as unknown as NodeJS.Module;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || /(debugLogger|settings-export|vocabulary)\.js$/.test(key)) {
      delete require.cache[key];
    }
  }
  return {
    vault: require("../../bridge/vault/vault-service.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    files: require("../../bridge/vault/vault-files.js"),
    settings: require("../../bridge/settings-export.js"),
    vocabulary: require("../../bridge/vocabulary.js"),
  };
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-settings-sealed-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("settings export/import with encryption on", () => {
  async function encrypted() {
    const m = boot();
    const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
    await m.vault.adoptNewVault(v, masterKey);
    m.files.writeJson(path.join(userData, "whisperwoof-vocabulary.json"), [{ word: "Mando" }]);
    return m;
  }

  it("exports Memory read from its sealed file", async () => {
    const m = await encrypted();
    const { bundle } = m.settings.exportSettings({});
    expect(bundle.data.vocabulary).toEqual([{ word: "Mando" }]);
  });

  it("imports Memory sealed, with no plain copy left behind", async () => {
    const m = await encrypted();
    const { bundle } = m.settings.exportSettings({});
    const result = m.settings.importSettings({ ...bundle, data: { vocabulary: [{ word: "Woof" }] } }, { merge: false });
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(userData, "whisperwoof-vocabulary.json"))).toBe(false);
    expect(m.files.readJson(path.join(userData, "whisperwoof-vocabulary.json"), null)).toEqual([{ word: "Woof" }]);
  });

  it("an import shows up in Memory right away, and the next Memory change keeps it", async () => {
    const m = await encrypted();
    expect(m.vocabulary.getVocabulary().map((w: { word: string }) => w.word)).toEqual(["Mando"]); // Memory loaded (cached)
    const { bundle } = m.settings.exportSettings({});
    m.settings.importSettings({ ...bundle, data: { vocabulary: [{ word: "Woof" }] } }, { merge: true });
    expect(m.vocabulary.getVocabulary().map((w: { word: string }) => w.word).sort()).toEqual(["Mando", "Woof"]);

    m.vocabulary.addWord("Bark");
    m.vocabulary.flushToDisk();
    const saved = m.files.readJson(path.join(userData, "whisperwoof-vocabulary.json"), []);
    expect(saved.map((w: { word: string }) => w.word).sort()).toEqual(["Bark", "Mando", "Woof"]);
  });
});
