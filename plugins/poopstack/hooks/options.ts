import type { PluginOptions } from 'claude-code';

// The mod's settings, read once from `register(on, options)`. The engine validates the values
// against plugin.json's `userConfig` and fills defaults before the module loads, so a value of
// the wrong shape here is a broken invariant of ours: it throws, and the engine names the plugin.

export const PRESETS = ['discreet', 'regular', 'maximum'] as const;
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

// Turns that get a joke, in the long run (decision 30). Guesses until measured.
const BY_PRESET: Readonly<Record<Preset, number>> = {
  discreet: 1 / 10,
  regular: 1 / 5,
  maximum: 1 / 3,
};

const BY_ENGAGEMENT: Readonly<Record<Exclude<Engagement, 'by-preset'>, number>> = {
  rare: 1 / 10,
  sometimes: 1 / 5,
  often: 1 / 3,
  always: 1,
};

export function turnRate(settings: Settings): number {
  return settings.engagement === 'by-preset'
    ? BY_PRESET[settings.preset]
    : BY_ENGAGEMENT[settings.engagement];
}

// Matched lines (the commit line) roll their own dice at about double the turn rate.
export function matchedRate(settings: Settings): number {
  return Math.min(1, 2 * turnRate(settings));
}

// "about 1 turn in 5", for the status text and the first-run toast.
export function describeRate(rate: number): string {
  return rate >= 1 ? 'every turn' : `about 1 turn in ${Math.round(1 / rate)}`;
}
