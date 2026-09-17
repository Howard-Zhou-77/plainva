import { afterEach, describe, expect, it, vi } from "vitest";
import { isRecoveryGroupHidden, maskRecoveryGroup, pickRecoveryChallenge } from "@plainva/ui";
import { isInsideVault } from "./services/workspaceSecurity/recoveryFileTarget";

describe("recovery code challenge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps the uniform draws to every ordered distinct pair exactly once", () => {
    const pairs = new Set<string>();
    for (let first = 0; first < 5; first++) for (let remaining = 0; remaining < 4; remaining++) {
      const words = [7, first, remaining]; // 7 must be rejected for a range of five.
      const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(array => {
        (array as Uint32Array)[0] = words.shift()!;
        return array;
      });
      const pair = pickRecoveryChallenge(5);
      expect(random).toHaveBeenCalledTimes(3);
      expect(pair[0]).not.toBe(pair[1]);
      expect(pair.every(index => index >= 0 && index < 5)).toBe(true);
      pairs.add(pair.join(",")); random.mockRestore();
    }
    expect(pairs.size).toBe(20);
  });

  it("refuses invalid counts and never falls back when the random source fails", () => {
    for (const count of [-1, 1.5, NaN, Infinity, 0x1_0000_0001]) expect(() => pickRecoveryChallenge(count)).toThrow(RangeError);
    expect(pickRecoveryChallenge(1)).toEqual([0, 0]);
    vi.spyOn(crypto, "getRandomValues").mockImplementation(() => { throw new Error("random unavailable"); });
    expect(() => pickRecoveryChallenge(15)).toThrow("random unavailable");
  });
  it("asks for two different groups", () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const [first, second] = pickRecoveryChallenge(15);
      expect(first).not.toBe(second);
      expect(first).toBeLessThan(15);
      expect(second).toBeLessThan(15);
    }
  });

  it("hides exactly the groups it is asking for", () => {
    const challenge = [3, 7] as const;
    const hidden = (groupIndex: number) =>
      isRecoveryGroupHidden({ groupIndex, challenge, revealed: false, answeredCorrectly: false });
    expect(hidden(3)).toBe(true);
    expect(hidden(7)).toBe(true);
    expect(hidden(4)).toBe(false);
  });

  it("shows a group again once its answer is right, and shows everything once revealed", () => {
    const challenge = [3, 7] as const;
    expect(isRecoveryGroupHidden({ groupIndex: 3, challenge, revealed: false, answeredCorrectly: true })).toBe(false);
    expect(isRecoveryGroupHidden({ groupIndex: 3, challenge, revealed: true, answeredCorrectly: false })).toBe(false);
  });

  it("masks without changing the width, so revealing does not reflow the code", () => {
    expect(maskRecoveryGroup("ABCDE")).toHaveLength(5);
    expect(maskRecoveryGroup("ABCDE")).not.toContain("A");
  });
});

describe("recovery file target", () => {
  it("refuses the vault it unlocks, its subfolders, and nothing else", () => {
    const vault = "C:/Users/x/Vault";
    expect(isInsideVault("C:/Users/x/Vault/key.pvrec", vault)).toBe(true);
    // Windows separators reach this guard verbatim; the backslash is built to survive tooling.
    const back = ["C:", "Users", "x", "Vault", "sub", "key.pvrec"].join(String.fromCharCode(92));
    expect(isInsideVault(back, vault)).toBe(true);
    expect(isInsideVault("C:/Users/x/Vault", vault)).toBe(true);
    expect(isInsideVault("C:/Users/x/Backup/key.pvrec", vault)).toBe(false);
    // The prefix matches as text but is a different folder — a slash-less prefix must not count.
    expect(isInsideVault("C:/Users/x/VaultBackup/key.pvrec", vault)).toBe(false);
  });
});
