// What p(oop)stack keeps in $.state, one set per session; it survives reloads and compactions,
// but not a restart with `claude --resume` (observed 2026-10-26), so the commit count lives in
// $.store instead (hooks/commits.ts).
//
// isOff: `/poopstack off` was asked in this session; stops every rewrite at once, before the
//   module reloads with `enabled` false, and stays set if the setting could not be written.
// wasEnabled: `enabled` as the last load saw it, so a load that sees it turn on in /config
//   clears isOff.
// rng: the session's generator state (hooks/pick.ts).
// phrase: the base phrase of the running or next main turn; null when that turn is plain.
// bag: the phrases still to come before the vocabulary repeats.
// turnMisses, commitMisses, outcomeMisses: rolls since each channel's dice last hit (outcome:
//   the line for an interrupted turn).

export type TurnPhrase = string | null;

declare module 'claude-code' {
  interface PluginState {
    poopstack: {
      isOff: boolean;
      wasEnabled: boolean;
      rng: number;
      phrase: TurnPhrase;
      bag: readonly string[];
      turnMisses: number;
      commitMisses: number;
      outcomeMisses: number;
    };
  }
}
