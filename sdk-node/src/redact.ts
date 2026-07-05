/**
 * Local PII redaction — runs inside the user's process BEFORE anything leaves
 * the app. Pantau's servers never see raw bodies/headers.
 *
 * Two tiers:
 *  - MASK  → value replaced with '[REDACTED]'. Not searchable, not readable.
 *            For secrets (password, token, card) — no reason to ever query them.
 *  - HASH  → value replaced with '#<hmac16>'. Not readable, but SEARCHABLE:
 *            the same input always yields the same hash, so you can look up
 *            "did user X hit /login" by hashing X the same way. HMAC is keyed
 *            with the account api_key so a DB leak can't be reversed.
 */
import { createHmac } from 'crypto';

const DENY_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization',
]);

// Full-mask keys: secrets, never searchable.
const DEFAULT_DENY_KEYS = [
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'authorization', 'cookie', 'credit_card', 'card_number', 'cardnumber',
  'cvv', 'cvc', 'ssn', 'pin', 'private_key', 'access_token', 'refresh_token',
];

// Hash keys: PII you may need to search on (GDPR / UU PDP) — stored as a
// keyed hash, searchable but not readable.
const DEFAULT_HASH_KEYS = ['email', 'phone', 'nik', 'passport'];

// Partial keys: PII shown partly (b***@gmail.com). Readable-ish, NOT reliably
// searchable. Empty by default — opt in via capture.partialKeys.
const DEFAULT_PARTIAL_KEYS: string[] = [];

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

export interface RedactOptions {
  denyKeys?: string[];
  hashKeys?: string[];
  partialKeys?: string[];
  hashSecret?: string; // HMAC key (the account api_key). Without it, hash keys fall back to mask.
}

function matches(key: string, list: string[]): boolean {
  const k = key.toLowerCase();
  return list.some((d) => k.includes(d));
}

/** Deterministic keyed hash of a value: '#' + first 16 hex of HMAC-SHA256. */
export function hashValue(value: unknown, secret: string): string {
  const norm = String(value).trim().toLowerCase();
  return '#' + createHmac('sha256', secret).update(norm).digest('hex').slice(0, 16);
}

/**
 * Partially mask a value, keeping just enough to eyeball it:
 *  - email:  b***@gmail.com   (first char + domain)
 *  - other:  keep last 2 chars, e.g. ****89
 */
export function partialMask(value: unknown): string {
  const s = String(value);
  const at = s.indexOf('@');
  if (at > 0) {
    const local = s.slice(0, at);
    const domain = s.slice(at);
    const head = local[0];
    return `${head}***${domain}`;
  }
  if (s.length <= 2) return '***';
  return '***' + s.slice(-2);
}

/** Deep-clone `value`, masking secrets and hashing searchable PII. */
export function redactBody(value: unknown, opts: RedactOptions = {}, depth = 0): unknown {
  const denyKeys = opts.denyKeys ?? DEFAULT_DENY_KEYS;
  const hashKeys = opts.hashKeys ?? DEFAULT_HASH_KEYS;
  const partialKeys = opts.partialKeys ?? DEFAULT_PARTIAL_KEYS;

  if (depth > MAX_DEPTH || value == null) return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactBody(v, opts, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const isPrimitive = v != null && typeof v !== 'object';
      if (matches(k, denyKeys)) {
        out[k] = REDACTED;
      } else if (matches(k, partialKeys)) {
        // Partial takes priority over hash: readable-ish beats searchable.
        out[k] = isPrimitive ? partialMask(v) : redactBody(v, opts, depth + 1);
      } else if (matches(k, hashKeys)) {
        // Only hash primitives; hash secret required, else mask.
        out[k] = opts.hashSecret != null && isPrimitive
          ? hashValue(v, opts.hashSecret)
          : (isPrimitive ? REDACTED : redactBody(v, opts, depth + 1));
      } else {
        out[k] = redactBody(v, opts, depth + 1);
      }
    }
    return out;
  }

  return value;
}

export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = DENY_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}
