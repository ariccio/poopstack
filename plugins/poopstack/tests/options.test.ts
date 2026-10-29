import type { ConfigRow } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import { isOwnRow, matchedRate, turnRate } from '../hooks/options';
import { poolFor } from '../hooks/vocabulary';

function row(key: string, owner: string): ConfigRow {
  return {
    key,
    label: '',
    kind: 'boolean',
    value: true,
    provider: { plugin: owner, tier: 'user' },
    isLocked: false,
  };
}

test("a row is the mod's own by its key and its owner, however the mod was loaded", () => {
  for (const owner of ['poopstack', 'poopstack@inline', 'poopstack@poopstack']) {
    expect(isOwnRow(row('poopstack.preset', owner), 'poopstack', 'preset')).toBe(true);
  }
  expect(isOwnRow(row('poopstack@inline.preset', 'poopstack@inline'), 'poopstack', 'preset')).toBe(
    true,
  );
});

test("another plugin's row, a look-alike name or another field is not the mod's", () => {
  expect(isOwnRow(row('poopstack.preset', 'other@inline'), 'poopstack', 'preset')).toBe(false);
  expect(
    isOwnRow(row('poopstack-probe.preset', 'poopstack-probe@inline'), 'poopstack', 'preset'),
  ).toBe(false);
  expect(isOwnRow(row('poopstack.enabled', 'poopstack@inline'), 'poopstack', 'preset')).toBe(false);
});

test('poopmaxxing is maximum on every turn, unless a joke rate is set', () => {
  const settings = { isEnabled: true, preset: 'poopmaxxing', engagement: 'by-preset' } as const;
  expect(turnRate(settings)).toBe(1);
  expect(matchedRate(settings)).toBe(1);
  const oneInTen = 1 / 10;
  const oneInThree = 1 / 3;
  expect(turnRate({ ...settings, engagement: 'rare' })).toBe(oneInTen);
  expect(turnRate({ ...settings, preset: 'maximum' })).toBe(oneInThree);
  expect(poolFor('poopmaxxing')).toEqual(poolFor('maximum'));
});
