import type { ConfigRow, PluginOptions } from 'claude-code';

// The mod's settings, read once from `register(on, options)`. The engine validates the values
// against plugin.json's `userConfig` and fills defaults before the module loads, so a value of
// the wrong shape here is a broken invariant of ours: it throws, and the engine names the plugin.

export const PRESETS = ['discreet', 'regular', 'maximum', 'poopmaxxing'] as const;
export type Preset = (typeof PRESETS)[number];

export const ENGAGEMENTS = ['by-preset', 'rare', 'sometimes', 'often', 'always'] as const;
export type Engagement = (typeof ENGAGEMENTS)[number];

export type Settings = {
  readonly isEnabled: boolean;
  readonly preset: Preset;
  readonly engagement: Engagement;
};

export function isPreset(value: unknown): value is Preset {
  return PRESETS.some((preset) => preset === value);
}

function isEngagement(value: unknown): value is Engagement {
  return ENGAGEMENTS.some((engagement) => engagement === value);
}

export function readSettings(options: PluginOptions): Settings {
  const { enabled: isEnabled, preset, engagement } = options;
  if (typeof isEnabled !== 'boolean' || !isPreset(preset) || !isEngagement(engagement)) {
    throw new Error(
      `poopstack: options do not match plugin.json's userConfig: ${JSON.stringify(options)}`,
    );
  }
  return { isEnabled, preset, engagement };
}

// Whether a /config row is this plugin's row for one of its userConfig fields. The key is
// `<plugin>.<field>` (the types); the owner is the plugin's name, or that name with a suffix for
// how it was loaded: `poopstack@inline` under --plugin-dir and `<name>@<marketplace>` for an
// install, `poopstack@poopstack` (both measured 2026-10-28, FINDINGS 49). A mod loaded from a
// session's mods folder has no rows at all (measured).
export function isOwnRow(row: ConfigRow, plugin: string, field: string): boolean {
  const owner = row.provider.plugin;
  const loadedPrefix = `${plugin}@`;
  const isOwner = owner === plugin || owner.startsWith(loadedPrefix);
  const pluginKey = `${plugin}.${field}`;
  const ownerKey = `${owner}.${field}`;
  const isFieldKey = row.key === pluginKey || row.key === ownerKey;
  return isOwner && isFieldKey;
}

// One joke in this many turns, in the long run (decision 30). Guesses until measured. poopmaxxing
// is maximum's vocabulary on every turn (decision 78, his ask, 2026-10-28).
const TURNS_PER_JOKE_BY_PRESET: Readonly<Record<Preset, number>> = {
  discreet: 10,
  regular: 5,
  maximum: 3,
  poopmaxxing: 1,
};

const TURNS_PER_JOKE_BY_ENGAGEMENT: Readonly<Record<Exclude<Engagement, 'by-preset'>, number>> = {
  rare: 10,
  sometimes: 5,
  often: 3,
  always: 1,
};

export function turnRate(settings: Settings): number {
  const turnsPerJoke =
    settings.engagement === 'by-preset'
      ? TURNS_PER_JOKE_BY_PRESET[settings.preset]
      : TURNS_PER_JOKE_BY_ENGAGEMENT[settings.engagement];
  return 1 / turnsPerJoke;
}

// Matched lines (the commit line) roll their own dice at about double the turn rate.
export function matchedRate(settings: Settings): number {
  const rate = turnRate(settings);
  const doubled = 2 * rate;
  return Math.min(1, doubled);
}

// "about 1 turn in 5", for the status text and the first-run toast.
export function describeRate(rate: number): string {
  if (rate >= 1) {
    return 'every turn';
  }
  const turnsPerJoke = 1 / rate;
  const rounded = Math.round(turnsPerJoke);
  return `about 1 turn in ${String(rounded)}`;
}
