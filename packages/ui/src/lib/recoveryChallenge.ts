/**
 * The rules behind "prove you wrote the recovery code down".
 *
 * Both shells asked for two groups and printed those very groups directly above the input
 * fields (finding 2026-08-25, B6). That checks transcription, not possession — the one thing
 * the step exists to establish. The requested groups are therefore hidden while the check is
 * open, and revealing them draws a fresh pair, so looking is never a shortcut past the check.
 */

/** Rejection sampling over a power-of-two range, without modulo bias. */
function uniformIndex(count: number): number {
  if (count === 1) return 0;
  const mask = (2 ** Math.ceil(Math.log2(count)) - 1) >>> 0;
  const word = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(word);
    const index = (word[0] & mask) >>> 0;
    if (index < count) return index;
  }
}

/** Two distinct group indexes, or `[0, 0]` when a code is too short to ask twice. */
export function pickRecoveryChallenge(groupCount: number): [number, number] {
  if (!Number.isSafeInteger(groupCount) || groupCount < 0 || groupCount > 0x1_0000_0000) throw new RangeError("Invalid recovery group count");
  if (groupCount < 2) return [0, 0];
  const first = uniformIndex(groupCount);
  const remaining = uniformIndex(groupCount - 1);
  return [first, remaining >= first ? remaining + 1 : remaining];
}

/** Same width as the value it stands in for, so revealing does not reflow the code. */
export function maskRecoveryGroup(group: string): string {
  return "•".repeat(group.length);
}

/**
 * Hidden means: this group is being asked for, the user has not answered it correctly yet,
 * and they have not deliberately revealed the code. A group answered correctly comes back
 * into view — the user has just proven they have it, and hiding it further only nags.
 */
export function isRecoveryGroupHidden(input: {
  groupIndex: number;
  challenge: readonly [number, number];
  revealed: boolean;
  answeredCorrectly: boolean;
}): boolean {
  if (input.revealed || input.answeredCorrectly) return false;
  return input.challenge.includes(input.groupIndex);
}
