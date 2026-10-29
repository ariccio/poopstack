// Pure randomness: a seeded generator, the shuffle bag and the engagement dice. Nothing here
// touches `$`, so the tests drive every function with fixed numbers.

export type Draw = { readonly state: number; readonly value: number };

// One step of mulberry32: the next generator state and a number in [0, 1).
export function nextRandom(state: number): Draw {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

// FNV-1a over UTF-16 code units: a stable 32-bit number for an id.
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

// The engagement dice are a pseudo-random distribution: the n-th roll since the last hit hits
// with chance min(1, c × n), so jokes come at a steady rate without long droughts or clumps.
function chanceAt(constant: number, roll: number): number {
  return Math.min(1, constant * roll);
}

// How many rolls the dice keep going past, at most, before every roll is a sure hit.
function horizon(constant: number): number {
  return Math.ceil(1 / constant);
}

// The long-run hit rate of the dice with constant `constant`.
export function prdRate(constant: number): number {
  let survive = 1;
  let expected = 0;
  for (let roll = 1; roll <= horizon(constant); roll += 1) {
    const chance = chanceAt(constant, roll);
    expected += roll * survive * chance;
    survive *= 1 - chance;
  }
  return 1 / expected;
}

// The constant whose long-run hit rate is `rate`, by bisection (prdRate rises with it).
export function prdConstant(rate: number): number {
  if (!(rate >= 0.01 && rate <= 1)) {
    throw new Error(`poopstack: an engagement rate must lie in [0.01, 1], not ${rate}`);
  }
  let low = 0.0001;
  let high = 1;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (prdRate(middle) < rate) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return high;
}

// A warm start: how many misses a session opens with, drawn from the dice's long-run spread,
// so the first turns of a session are not all plain. `u` is a number in [0, 1).
export function warmMisses(constant: number, u: number): number {
  const survival: number[] = [];
  let survive = 1;
  for (let misses = 0; misses < horizon(constant); misses += 1) {
    survival.push(survive);
    survive *= 1 - chanceAt(constant, misses + 1);
  }
  const total = survival.reduce((sum, value) => sum + value, 0);
  let target = u * total;
  for (const [misses, value] of survival.entries()) {
    target -= value;
    if (target < 0) {
      return misses;
    }
  }
  return survival.length - 1;
}

export type Roll = { readonly isHit: boolean; readonly misses: number };

export function roll(constant: number, misses: number, u: number): Roll {
  const isHit = u < chanceAt(constant, misses + 1);
  return { isHit, misses: isHit ? 0 : misses + 1 };
}

export type Bag = {
  readonly phrase: string;
  readonly bag: readonly string[];
  readonly state: number;
};

// Fisher-Yates over a copy, advancing the generator once per swap.
export function shuffle(
  items: readonly string[],
  state: number,
): { order: string[]; state: number } {
  const order = [...items];
  let current = state;
  for (let i = order.length - 1; i > 0; i -= 1) {
    const draw = nextRandom(current);
    current = draw.state;
    const j = Math.floor(draw.value * (i + 1));
    const held = order[i];
    const swapped = order[j];
    if (held === undefined || swapped === undefined) {
      throw new Error('poopstack: the shuffle stepped outside its list');
    }
    order[i] = swapped;
    order[j] = held;
  }
  return { order, state: current };
}

// The next phrase from the session's bag: no phrase repeats until the whole pool has shown, and
// a refilled bag never opens with the phrase shown last. Phrases no longer in the pool (the
// preset changed) are dropped from the bag.
export function drawPhrase(
  bag: readonly string[],
  pool: readonly string[],
  last: string | null,
  state: number,
): Bag {
  const remaining = bag.filter((phrase) => pool.includes(phrase));
  if (remaining.length > 0) {
    const [phrase, ...rest] = remaining;
    if (phrase !== undefined) {
      return { phrase, bag: rest, state };
    }
  }
  const refill = shuffle(pool, state);
  const [first, ...rest] = refill.order;
  if (first === undefined) {
    throw new Error('poopstack: the vocabulary pool is empty');
  }
  if (first === last && rest.length > 0) {
    return { phrase: rest[0] ?? first, bag: [...rest.slice(1), first], state: refill.state };
  }
  return { phrase: first, bag: rest, state: refill.state };
}
