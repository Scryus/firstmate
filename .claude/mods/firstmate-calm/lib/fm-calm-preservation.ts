// Pi Calm policy for deciding whether mid-turn assistant text is substantive.
// The Pi extension reaches this file through its tracked symlink; the Claude Code mod
// hides no assistant text, so it does not use this rule.

/** The minimum trimmed text length preserved from a mid-turn assistant message. */
export const CALM_PRESERVE_MIN_CHARS = 240;

/** Whether mid-turn assistant text is substantive enough to remain visible. */
export function calmTextIsSubstantive(text: string): boolean {
  return text.includes("\n") || text.trim().length >= CALM_PRESERVE_MIN_CHARS;
}
