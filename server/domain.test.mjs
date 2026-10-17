import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOrder,
  validateSamples,
  fallbackOrder,
  validateRouting,
} from './domain.mjs';
test('rejects unknown actions, malformed ids and invalid telemetry', () => {
  assert.throws(() =>
    validateOrder({ intent: 'MEDICATE', requestId: 'abcdefgh' }),
  );
  assert.throws(() => validateOrder({ intent: 'WATER', requestId: '../x' }));
  assert.throws(() =>
    validateSamples([{ x: NaN, y: 0, jitter: 0, blinkMs: 0 }]),
  );
  assert.throws(() =>
    validateSamples([{ x: 1.1, y: 0, jitter: 0, blinkMs: 0 }]),
  );
  assert.throws(() =>
    validateSamples(Array(121).fill({ x: 0, y: 0, jitter: 0, blinkMs: 0 })),
  );
  assert.deepEqual(
    validateOrder({ intent: 'WATER', requestId: 'abcdefgh', extra: 'ignored' }),
    { intent: 'WATER', requestId: 'abcdefgh' },
  );
});
test('demo rules use actual room hour and validate AI output', () => {
  assert.match(fallbackOrder('COMFORT', 22).summary, /bedding/);
  assert.equal(fallbackOrder('RESTROOM', 12).department, 'Care team');
  assert.throws(() =>
    validateRouting({
      department: 'Pharmacy',
      summary: 'Administer medication',
    }),
  );
  assert.throws(() =>
    validateRouting({ department: 'Care team', summary: '' }),
  );
});
