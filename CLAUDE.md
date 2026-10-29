# p(oop)stack

A Claude Code mod (plugin `poopstack`) that turns Claude Code's progress words into bathroom
puns, without ever hiding what Claude is really doing. The design contract is
`docs/design.md`; the plan is `docs/planning/`.

## Layout

- `plugins/poopstack/`: the mod (`hooks/`, `tests/`, `.claude-plugin/plugin.json`). It ships no
  dependencies; `.claude-plugin/types/` is laid by the engine on load and never committed.
- `.claude-plugin/marketplace.json`: makes this repository installable.
- Everything else is development tooling: pnpm, Biome, ast-grep, TypeScript, ESLint with
  typescript-eslint (the type-aware lane, `eslint.config.mjs`), lefthook.

## Commands

- `pnpm install`, then `pnpm hooks:install` (lefthook; its own install script is disabled on
  purpose).
- `pnpm lint` · `pnpm fix` · `pnpm check:ast` · `pnpm typecheck` · `pnpm lint:types` ·
  `pnpm plugin:validate` · `pnpm plugin:test` · `pnpm test:scripts` · `pnpm security:gitleaks`.
- `pnpm typecheck` and `pnpm lint:types` need the engine-laid types: load the mod once
  (`claude --plugin-dir plugins/poopstack`) on a checkout. CI cannot run them.

## Rules

- Error handling: `.claude/rules/error-handling.md` (two lanes by ownership; no success-shaped
  defaults; every hook passes the unexpected through).
- The model never sees a joke: no `prompt.compose`, no prompt context, no attribution text.
- Off means off at once: `/poopstack off` stops every rewrite, timer, sound and store write.
- Store only a flag, session ids, counts and the time of their last write (`docs/design.md`,
  item 7); never prompts, paths, commands or output.
- Never loosen a gate quietly: a threshold, a rule, a test or a suppression that gets weaker is
  said aloud with its reason.
- Prove a new gate fails once (plant a violation, watch it fail, revert) before trusting green,
  and prove hook gates in their real venue: a real commit, a real push.
- One owner per lint rule: a rule Biome and typescript-eslint share is switched off in one of them
  (`eslint.config.mjs` says which and why).
- Never give two test files the same name with `.ts` and `.tsx`: TypeScript then checks only the
  `.ts` one (found 2026-10-28, when a 1,110-line test had never been type-checked);
  `pnpm lint:types` fails on any file outside the type check.
- Commit subjects are conventional (`feat(scope): …`); the commit-msg hook checks them.
- Never bypass the hooks (`--no-verify` is denied in `.claude/settings.json`).
