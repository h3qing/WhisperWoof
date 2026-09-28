/**
 * Native sidecars (whisper-server, llama-server, ffmpeg) get the app's
 * environment minus the user's cloud API keys, tokens and loader-injection
 * variables.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildSidecarEnv, isSecretEnvName, isStrippedEnvName } = require(
  "../../bridge/sidecar-env-pure.js"
);

const APP_SECRETS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CUSTOM_TRANSCRIPTION_API_KEY",
  "CUSTOM_REASONING_API_KEY",
  "TODOIST_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "HF_TOKEN",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "SOME_APIKEY",
  "DB_PASSWORD",
  "TOKEN",
  "openai_api_key",
];

const KEPT = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/u",
  TMPDIR: "/tmp/u",
  LANG: "en_US.UTF-8",
  LD_LIBRARY_PATH: "/opt/lib",
  DYLD_LIBRARY_PATH: "/opt/lib",
  SystemRoot: "C:\\Windows",
  // App settings that merely end in KEY / look key-ish but aren't secrets.
  DICTATION_KEY: "Fn",
  AGENT_KEY: "Fn+A",
  LLAMA_GPU_BACKEND: "vulkan",
  TOKENIZERS_PARALLELISM: "false",
  KEYCHAIN_PATH: "/x",
};

describe("isSecretEnvName", () => {
  it.each(APP_SECRETS)("treats %s as a secret", (name) => {
    expect(isSecretEnvName(name)).toBe(true);
  });

  it.each(Object.keys(KEPT))("leaves %s alone", (name) => {
    expect(isSecretEnvName(name)).toBe(false);
  });
});

describe("isStrippedEnvName", () => {
  it("strips dynamic-loader injection variables, any case", () => {
    for (const name of ["LD_PRELOAD", "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "ld_preload"]) {
      expect(isStrippedEnvName(name)).toBe(true);
    }
  });

  it("keeps the library search paths the app sets for bundled libs", () => {
    expect(isStrippedEnvName("LD_LIBRARY_PATH")).toBe(false);
    expect(isStrippedEnvName("DYLD_LIBRARY_PATH")).toBe(false);
  });
});

describe("buildSidecarEnv", () => {
  const base: Record<string, string | undefined> = {
    ...KEPT,
    ...Object.fromEntries(APP_SECRETS.map((n) => [n, `secret-${n}`])),
    LD_PRELOAD: "/tmp/evil.so",
    DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
    UNSET_VAR: undefined,
  };

  it("drops every secret and loader-injection variable", () => {
    const env = buildSidecarEnv(base);
    for (const name of APP_SECRETS) expect(env).not.toHaveProperty(name);
    expect(env).not.toHaveProperty("LD_PRELOAD");
    expect(env).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
    expect(Object.values(env).some((v) => String(v).startsWith("secret-"))).toBe(false);
  });

  it("keeps everything else untouched", () => {
    const env = buildSidecarEnv(base);
    expect(env).toMatchObject(KEPT);
    expect(env).not.toHaveProperty("UNSET_VAR");
  });

  it("applies extras after stripping, so a sidecar's own key survives", () => {
    const env = buildSidecarEnv(
      { ...base, LLAMA_API_KEY: "users-own-key" },
      { LLAMA_API_KEY: "per-process-key", PORT: 8200, SKIP: undefined, NUL: null }
    );
    expect(env.LLAMA_API_KEY).toBe("per-process-key");
    expect(env.PORT).toBe("8200");
    expect(env).not.toHaveProperty("SKIP");
    expect(env).not.toHaveProperty("NUL");
  });

  it("does not modify the environment it copies", () => {
    const input = { OPENAI_API_KEY: "sk-1", PATH: "/bin" };
    const env = buildSidecarEnv(input, { PATH: "/other" });
    expect(input).toEqual({ OPENAI_API_KEY: "sk-1", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/other" });
  });

  it("tolerates a missing environment", () => {
    expect(buildSidecarEnv(undefined)).toEqual({});
    expect(buildSidecarEnv(null, { A: "1" })).toEqual({ A: "1" });
  });
});
