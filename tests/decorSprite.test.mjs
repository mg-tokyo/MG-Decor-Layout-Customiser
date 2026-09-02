// tests/decorSprite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateZIndex } from '../src/decorSprite.js';

test('calculateZIndex matches the game formula', () => {
  assert.equal(calculateZIndex(128, 500), Math.floor(128 * 10000) + 1 + 0.5);
  assert.equal(calculateZIndex(128, 2000), Math.floor(128 * 10000) + 1 + 0.9); // tie-breaker caps at 0.9
  assert.equal(calculateZIndex(0, 0), 1);
});
