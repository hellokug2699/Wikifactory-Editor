import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../app/assets/js/async-pool.js';

test('results keep the input order', async () => {
  const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
    await new Promise((resolve) => setTimeout(resolve, value * 5));
    return value * 2;
  });
  assert.deepEqual(result, [6, 2, 4]);
});

test('never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  await mapWithConcurrency(
    Array.from({ length: 12 }, (_, index) => index),
    3,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    },
  );
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.ok(peak > 1, 'expected some parallelism');
});

test('handles empty input and clamps invalid limits', async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async (value) => value), []);
  const result = await mapWithConcurrency([1, 2], 0, async (value) => value + 1);
  assert.deepEqual(result, [2, 3]);
});
