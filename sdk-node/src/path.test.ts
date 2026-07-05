import assert from 'assert';
import { normalizePath } from './index';

assert.strictEqual(normalizePath('/products/1'), '/products/:id');
assert.strictEqual(normalizePath('/products/999'), '/products/:id');
assert.strictEqual(normalizePath('/users/550e8400-e29b-41d4-a716-446655440000/posts'), '/users/:id/posts');
assert.strictEqual(normalizePath('/orders/507f1f77bcf86cd799439011'), '/orders/:id');
assert.strictEqual(normalizePath('/'), '/');
assert.strictEqual(normalizePath('/products'), '/products');
assert.strictEqual(normalizePath('/api/v2/health'), '/api/v2/health'); // v2 kept (not pure digits)
console.log('✓ normalizePath self-check passed');
