import type { ConfigRow } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import { isOwnRow } from '../hooks/options';

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
