import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStep } from './build-step';

test('Expo Go is red with an install instruction, never a bare status word', () => {
  const step = buildStep('storeClient', 'android');
  assert.equal(step.ok, false);
  assert.equal(step.value, 'Expo Go');
  assert.match(step.fix ?? '', /Install the PU Transit Driver app/);
  assert.equal(step.action, 'none');
});

test('the browser is red on any execution environment', () => {
  assert.equal(buildStep('bare', 'web').ok, false);
  assert.match(buildStep('standalone', 'web').fix ?? '', /browser cannot run it/);
});

test('development and store builds on a phone are green', () => {
  for (const env of ['bare', 'standalone']) {
    for (const platform of ['android', 'ios']) {
      const step = buildStep(env, platform);
      assert.deepEqual(step, { ok: true, value: 'installed app', fix: null, action: 'none' });
    }
  }
});
