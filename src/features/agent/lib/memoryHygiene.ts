/**
 * Secret redaction for model-authored memory. Mirrors the hygiene rule in the
 * codex memory pipeline: credentials never land on disk, they are replaced with
 * a fixed marker so the surrounding note stays useful.
 */

export const REDACTED_SECRET = "[REDACTED_SECRET]";

/** Whole-token patterns for well-known credential formats. */
const TOKEN_PATTERNS: RegExp[] = [
  // PEM private key blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // OpenAI / Anthropic style: sk-..., sk-ant-..., sk-proj-...
  /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_-]{20,}\b/g,
  // Stripe style: sk_live_..., rk_test_...
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Slack tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API key
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

/** `Authorization: Bearer <token>` — keep the scheme, drop the token. */
const BEARER_PATTERN = /(\bbearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi;

/**
 * `password: hunter22`, `API_KEY=abc123...` — a secret-ish key followed by a
 * compact, secret-looking value (no spaces, at least 6 chars, contains a digit or
 * is long). Prose like "api key: stored in the vault" is left alone.
 */
const KEY_VALUE_PATTERN =
  /(\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token)\b\s*[:=]\s*["'`]?)([A-Za-z0-9._~+/=-]{6,})/gi;

function looksLikeSecretValue(value: string): boolean {
  return value.length >= 16 || /\d/.test(value);
}

export interface RedactionResult {
  text: string;
  /** Number of replacements made. */
  redacted: number;
}

/** Replace anything that looks like a credential with {@link REDACTED_SECRET}. */
export function redactSecrets(text: string): RedactionResult {
  let redacted = 0;
  let out = text;

  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      redacted++;
      return REDACTED_SECRET;
    });
  }

  out = out.replace(BEARER_PATTERN, (_m, prefix: string) => {
    redacted++;
    return `${prefix}${REDACTED_SECRET}`;
  });

  out = out.replace(KEY_VALUE_PATTERN, (match, prefix: string, value: string) => {
    if (value === REDACTED_SECRET || !looksLikeSecretValue(value)) return match;
    redacted++;
    return `${prefix}${REDACTED_SECRET}`;
  });

  return { text: out, redacted };
}
