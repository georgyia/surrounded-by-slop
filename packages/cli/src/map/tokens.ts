/**
 * Token estimation for budget fitting. A deliberately dependency-free heuristic
 * (Rule 3): no tokenizer ships in the CLI. Code is punctuation-dense, so it
 * tokenizes at roughly 3.7 characters per token — between English prose (~4) and
 * the worst-case symbol soup (~3).
 *
 * This is an estimate, not a contract. SBS-112's acceptance pins it against a
 * real tokenizer in tests (a dev-dependency only); the budget carries enough
 * headroom that a ±15% error never blows a context window.
 */

const CHARS_PER_TOKEN = 3.7;

export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
