// Pure randomness: a seeded generator, the shuffle bag and the engagement dice. Nothing here
// touches `$`, so the tests drive every function with fixed numbers.

export type Draw = { readonly state: number; readonly value: number };

// mulberry32's published constants: the state's step, its three shifts and its odd multiplier.
const MULBERRY32 = { step: 0x6d2b79f5, shiftA: 15, shiftB: 7, odd: 61, shiftC: 14 } as const;
const UINT32_RANGE = 4_294_967_296;

// One step of mulberry32: the next generator state and a number in [0, 1). Each step is one
// operation; `>>> 0` reads a number as an unsigned 32-bit integer, and `^` and `|` read their
// operands as signed 32-bit integers, so the order of the steps is the published order.
export function nextRandom(state: number): Draw {
  const stepped = state + MULBERRY32.step;
  const next = stepped >>> 0;
  // Round one: fold the state's high bits into its low bits, then multiply by the state made odd.
  const nextShifted = next >>> MULBERRY32.shiftA;
  const nextFolded = next ^ nextShifted;
  const nextOdd = next | 1;
  const roundOne = Math.imul(nextFolded, nextOdd);
  // Round two: the same on round one's result, added to it, then XORed with it.
  const roundOneShifted = roundOne >>> MULBERRY32.shiftB;
  const roundOneFolded = roundOne ^ roundOneShifted;
  const roundOneOdd = roundOne | MULBERRY32.odd;
  const roundOneProduct = Math.imul(roundOneFolded, roundOneOdd);
  const roundOneSum = roundOne + roundOneProduct;
  const roundTwo = roundOne ^ roundOneSum;
  // The output: a last fold, read as unsigned, scaled into [0, 1).
  const roundTwoShifted = roundTwo >>> MULBERRY32.shiftC;
  const roundTwoFolded = roundTwo ^ roundTwoShifted;
  const roundTwoAsNonNegative = roundTwoFolded >>> 0;
  const value = roundTwoAsNonNegative / UINT32_RANGE;
  return { state: next, value };
}

// FNV-1a's published 32-bit offset basis and prime.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// FNV-1a over UTF-16 code units: a stable 32-bit number for an id.
export function hashId(id: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < id.length; i += 1) {
    const codeUnit = id.charCodeAt(i);
    const mixed = hash ^ codeUnit;
    const product = Math.imul(mixed, FNV_PRIME);
    hash = product >>> 0;
  }
  return hash;
}

// The engagement dice are a pseudo-random distribution: the n-th roll since the last hit hits
// with chance min(1, c × n), so jokes come at a steady rate without long droughts or clumps.
function chanceAt(constant: number, rollNumber: number): number {
  const growing = constant * rollNumber;
  return Math.min(1, growing);
}

// How many rolls the dice keep going past, at most, before every roll is a sure hit.
function horizon(constant: number): number {
  const rollsToCertainty = 1 / constant;
  return Math.ceil(rollsToCertainty);
}

// The long-run hit rate of the dice with constant `constant`: one over the expected number of
// rolls to a hit. `survive` is the chance that every roll before this one missed.
export function prdRate(constant: number): number {
  const lastRoll = horizon(constant);
  let survive = 1;
  let expected = 0;
  for (let rollNumber = 1; rollNumber <= lastRoll; rollNumber += 1) {
    const chance = chanceAt(constant, rollNumber);
    const weightedSurvival = rollNumber * survive;
    const contribution = weightedSurvival * chance;
    expected += contribution;
    const miss = 1 - chance;
    survive *= miss;
  }
  return 1 / expected;
}

// The lowest engagement rate the dice take, and the bisection's bounds: 60 halvings of [0.0001, 1]
// leave the constant exact to well under one part in 10^15.
const MIN_RATE = 0.01;
const LOWEST_CONSTANT = 0.0001;
const BISECTION_STEPS = 60;

// The constant whose long-run hit rate is `rate`, by bisection (prdRate rises with it).
export function prdConstant(rate: number): number {
  // Written as a positive test so that NaN, which fails every comparison, is refused too.
  const isAtLeastLowest = rate >= MIN_RATE;
  const isAtMostOne = rate <= 1;
  const isInRange = isAtLeastLowest && isAtMostOne;
  if (!isInRange) {
    throw new Error(
      `poopstack: an engagement rate must lie in [${String(MIN_RATE)}, 1], not ${String(rate)}`,
    );
  }
  let low = LOWEST_CONSTANT;
  let high = 1;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const sum = low + high;
    const middle = sum / 2;
    const middleRate = prdRate(middle);
    if (middleRate < rate) {
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
  const missLimit = horizon(constant);
  const survival: number[] = [];
  let survive = 1;
  for (let misses = 0; misses < missLimit; misses += 1) {
    survival.push(survive);
    const rollNumber = misses + 1;
    const chance = chanceAt(constant, rollNumber);
    const miss = 1 - chance;
    survive *= miss;
  }
  let total = 0;
  for (const value of survival) {
    total += value;
  }
  let target = u * total;
  for (const [misses, value] of survival.entries()) {
    target -= value;
    if (target < 0) {
      return misses;
    }
  }
  const mostMisses = survival.length - 1;
  return mostMisses;
}

export type Roll = { readonly isHit: boolean; readonly misses: number };

// One roll of the dice. After a miss, the misses count this roll too.
export function roll(constant: number, misses: number, u: number): Roll {
  const rollNumber = misses + 1;
  const chance = chanceAt(constant, rollNumber);
  const isHit = u < chance;
  const missesAfter = isHit ? 0 : rollNumber;
  return { isHit, misses: missesAfter };
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
  const lastIndex = order.length - 1;
  let current = state;
  for (let i = lastIndex; i > 0; i -= 1) {
    const draw = nextRandom(current);
    current = draw.state;
    const slots = i + 1;
    const scaled = draw.value * slots;
    const swapIndex = Math.floor(scaled);
    const held = order[i];
    const swapped = order[swapIndex];
    const isHeldMissing = held === undefined;
    const isSwappedMissing = swapped === undefined;
    if (isHeldMissing || isSwappedMissing) {
      throw new Error('poopstack: the shuffle stepped outside its list');
    }
    order[i] = swapped;
    order[swapIndex] = held;
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
  const [nextPhrase, ...stillToCome] = remaining;
  if (nextPhrase !== undefined) {
    return { phrase: nextPhrase, bag: stillToCome, state };
  }
  const refill = shuffle(pool, state);
  const [first, second, ...afterSecond] = refill.order;
  if (first === undefined) {
    throw new Error('poopstack: the vocabulary pool is empty');
  }
  // A refill that would open with the phrase just shown opens with its second phrase instead,
  // and the first goes to the end of the bag.
  const isRepeat = first === last;
  const hasSecond = second !== undefined;
  if (isRepeat && hasSecond) {
    return { phrase: second, bag: [...afterSecond, first], state: refill.state };
  }
  const rest = refill.order.slice(1);
  return { phrase: first, bag: rest, state: refill.state };
}
