import { expect, test } from 'claude-code/testing';
import {
  drawPhrase,
  hashId,
  nextRandom,
  prdConstant,
  prdRate,
  roll,
  shuffle,
  warmMisses,
} from '../hooks/pick';

test('the generator repeats from the same seed and stays in [0, 1)', () => {
  let a = 42;
  let b = 42;
  for (let i = 0; i < 1000; i += 1) {
    const x = nextRandom(a);
    const y = nextRandom(b);
    expect(x.value).toBe(y.value);
    expect(x.value >= 0 && x.value < 1).toBe(true);
    a = x.state;
    b = y.state;
  }
});

test('an id hashes to the same number every time, and different ids differ', () => {
  expect(hashId('7f12205b-26e4-4def')).toBe(hashId('7f12205b-26e4-4def'));
  expect(hashId('a') === hashId('b')).toBe(false);
});

test('each preset rate is met in the long run, within a percentage point', () => {
  for (const rate of [1 / 10, 1 / 5, 1 / 3, 2 / 3]) {
    const constant = prdConstant(rate);
    expect(Math.abs(prdRate(constant) - rate) < 1e-6).toBe(true);
    let state = 7;
    let misses = 0;
    let hits = 0;
    const rolls = 200_000;
    for (let i = 0; i < rolls; i += 1) {
      const draw = nextRandom(state);
      state = draw.state;
      const result = roll(constant, misses, draw.value);
      misses = result.misses;
      hits += result.isHit ? 1 : 0;
    }
    expect(Math.abs(hits / rolls - rate) < 0.01).toBe(true);
  }
});

test('always means every roll hits', () => {
  const constant = prdConstant(1);
  expect(roll(constant, 0, 0.999_999).isHit).toBe(true);
});

test('a rate outside [0.01, 1] is refused loudly', () => {
  expect(() => prdConstant(0)).toThrow();
  expect(() => prdConstant(1.5)).toThrow();
});

test('the dice never go a whole horizon without a hit', () => {
  const constant = prdConstant(1 / 10);
  const longest = Math.ceil(1 / constant);
  expect(roll(constant, longest - 1, 0.999_999).isHit).toBe(true);
});

test('a warm start lies inside the dice horizon', () => {
  const constant = prdConstant(1 / 5);
  for (const u of [0, 0.25, 0.5, 0.75, 0.999_999]) {
    const misses = warmMisses(constant, u);
    expect(misses >= 0 && misses < Math.ceil(1 / constant)).toBe(true);
  }
});

test('a shuffle is a permutation', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const { order } = shuffle(items, 99);
  expect([...order].sort()).toEqual([...items].sort());
});

test('the bag shows every phrase once before any repeats, and never the same one twice running', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  let bag: readonly string[] = [];
  let last: string | null = null;
  let state = 3;
  for (let cycle = 0; cycle < 50; cycle += 1) {
    const seen = new Set<string>();
    for (const _turn of pool) {
      const drawn = drawPhrase(bag, pool, last, state);
      expect(drawn.phrase === last).toBe(false);
      seen.add(drawn.phrase);
      ({ bag, state } = drawn);
      last = drawn.phrase;
    }
    expect(seen.size).toBe(pool.length);
  }
});

test('phrases that left the pool are dropped from the bag', () => {
  const drawn = drawPhrase(['gone', 'b'], ['a', 'b'], null, 1);
  expect(drawn.phrase).toBe('b');
});

test('an empty pool is a broken invariant', () => {
  expect(() => drawPhrase([], [], null, 1)).toThrow();
});
