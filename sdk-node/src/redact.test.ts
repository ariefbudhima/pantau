/** Runnable self-check for redaction. Run: npx tsx src/redact.test.ts */
import assert from 'assert';
import { redactBody, redactHeaders, hashValue, REDACTED } from './redact';

const SECRET = 'pk_test_secret';

// Secrets masked; PII hashed; safe values kept; structure preserved.
const body = redactBody({
  email: 'Budi@Gmail.com',
  password: 'hunter2',
  card: { cardNumber: '4111111111111111', last4: '1111' },
  items: [{ id: 1, token: 'abc' }],
}, { hashSecret: SECRET }) as any;

assert.strictEqual(body.password, REDACTED, 'password masked');
assert.strictEqual(body.card.cardNumber, REDACTED, 'nested cardNumber masked');
assert.strictEqual(body.card.last4, '1111', 'last4 kept');
assert.ok(body.email.startsWith('#'), 'email hashed, not masked');
assert.strictEqual(body.items[0].token, REDACTED, 'token in array masked');
assert.strictEqual(body.items[0].id, 1, 'array item id kept');

// Hash is deterministic + case/space-insensitive → searchable.
assert.strictEqual(body.email, hashValue('budi@gmail.com', SECRET), 'hash deterministic & normalized');
assert.notStrictEqual(hashValue('a@b.com', SECRET), hashValue('a@b.com', 'other'), 'hash keyed by secret');

// Without a secret, hash keys fall back to mask (never leak raw).
const noSecret = redactBody({ email: 'a@b.com' }) as any;
assert.strictEqual(noSecret.email, REDACTED, 'no secret → email masked, not raw');

// Partial mask: readable-ish, takes priority over hash.
const part = redactBody(
  { email: 'budi@gmail.com', phone: '08123456789', password: 'x' },
  { hashSecret: SECRET, partialKeys: ['email', 'phone'] }
) as any;
assert.strictEqual(part.email, 'b***@gmail.com', 'email partial-masked');
assert.strictEqual(part.phone, '***89', 'phone partial-masked (last 2)');
assert.strictEqual(part.password, REDACTED, 'password still fully masked');

// Headers.
const h = redactHeaders({ Authorization: 'Bearer x', 'content-type': 'application/json' });
assert.strictEqual(h.Authorization, REDACTED, 'auth header masked');
assert.strictEqual(h['content-type'], 'application/json', 'content-type kept');

console.log('✓ redact self-check passed');
