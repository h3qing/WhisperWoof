/**
 * Vault passwords: long enough and not on every guessing list, the same rule
 * in main (password-policy-pure) and in the renderer's form check
 * (vault-ui-pure); and the wait after wrong passwords at the lock screen.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { checkNewPassword, isTooEasyPassword } from "../../ui/vault/vault-ui-pure";

const require = createRequire(import.meta.url);
const policy = require("../../bridge/vault/password-policy-pure.js");
const vk = require("../../bridge/vault/vault-keys-pure.js");

describe("passwordProblem", () => {
  it("wants at least 8 characters", () => {
    expect(policy.passwordProblem("short")).toMatch(/at least 8 characters/);
    expect(policy.passwordProblem("a good password")).toBeNull();
  });

  it("refuses the passwords every wordlist starts with, in any case or Unicode form", () => {
    for (const pw of ["password", "Password1", "12345678", "QWERTYUIOP", "iloveyou", "ｐａｓｓｗｏｒｄ"]) {
      expect(policy.passwordProblem(pw), pw).toMatch(/too easy to guess/);
    }
    expect(policy.passwordProblem("zzzzzzzzzzzz")).toMatch(/too easy to guess/);
  });

  it("has a list of about a hundred entries, all long enough to pass the length rule on their own", () => {
    expect(policy.COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(100);
    for (const pw of policy.COMMON_PASSWORDS) expect([...pw].length, pw).toBeGreaterThanOrEqual(8);
  });

  it("is what creating a vault and changing the password enforce", () => {
    const crypto = require("crypto");
    const create = (password: string) =>
      vk.createVault({ entropy: crypto.randomBytes(16), password, kdf: { N: 1024, r: 8, p: 1 } });
    expect(() => create("password123")).toThrow(/too easy to guess/);
    const { vault, masterKey } = create("a good password");
    expect(() => vk.setPassword(vault, masterKey, "iloveyou1", { N: 1024, r: 8, p: 1 })).toThrow(/too easy/);
  });
});

describe("the renderer's check agrees with main's", () => {
  it("on the whole list and on ordinary passwords", () => {
    const samples = [...policy.COMMON_PASSWORDS, "Password1", "correct horse", "a good password", "aaaaaaaa", "zebra-quartz"];
    for (const pw of samples) {
      expect(isTooEasyPassword(pw), pw).toBe(policy.isTooEasy(pw));
      expect(checkNewPassword(pw, pw).ok, pw).toBe(policy.passwordProblem(pw) === null);
    }
  });
});

describe("unlockDelayMs", () => {
  it("lets three wrong passwords through, then doubles the wait up to 30 seconds", () => {
    expect([0, 1, 2].map(policy.unlockDelayMs)).toEqual([0, 0, 0]);
    expect([3, 4, 5, 6].map(policy.unlockDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(policy.unlockDelayMs(8)).toBe(30000);
    expect(policy.unlockDelayMs(500)).toBe(30000);
  });
});
