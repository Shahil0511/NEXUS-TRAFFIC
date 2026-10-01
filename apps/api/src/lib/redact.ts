/**
 * PII redaction for logs (house rule: never log full emails, keys or tokens).
 */

/** 'someone@libas.in' → 's***@libas.in' */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** 'nx_sk_AbCdEfGh…' → 'nx_sk_AbCd…' (first 10 chars only). */
export function maskKey(key: string): string {
  return key.length <= 10 ? '***' : `${key.slice(0, 10)}…`;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_KEY_NAMES = /(password|secret|token|authorization|cookie|key|pepper)/i;

/** Recursively mask emails in strings and drop values of secret-looking keys. */
export function redactMeta(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return value.replace(EMAIL_PATTERN, (m) => maskEmail(m));
  if (Array.isArray(value)) return value.map((v) => redactMeta(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactMeta(value.message, depth + 1) };
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY_NAMES.test(k) && typeof v === 'string' ? '[redacted]' : redactMeta(v, depth + 1),
      ]),
    );
  }
  return value;
}
