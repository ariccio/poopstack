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

## Code style (the maintainer's ask, 2026-10-29)

He finds nested expressions and chained async calls hard to read, so the code takes one
operation per step, each step's value with a name that says what it holds:

- Break a nested expression into named single steps (`hooks/pick.ts`'s `nextRandom` is the
  model). A chain of one operator (`a + b + c`), a template literal that formats a message, and a
  short callback to an array method stay whole.
- Inside `&&` or `||`, a comparison or a `!` on anything but a plain name gets a named const
  first (`const isStepText = props.word !== 'Working';`); a call may stay. Naming runs the operand
  every time, so where the right side needs the left (a null check, then a read), split with an
  early return instead. A lone comparison in a condition is one step.
- A name says what it holds in words, never in a type's spelling (`roundTwoAsNonNegative`, not
  `unsigned`).
- Every `await` is its own statement: never inside a member access, a call's arguments, a
  condition, an operator or a template. A `$.state.get` result is named `<key>Read` (the
  engine's `StateRead`) before its `.value` is used.
- Name an array before handing it on: `const reads = keys.map(async …)`, then
  `await Promise.all(reads)` (Biome forbids an `await` inside a loop).
- A state whose fields allow combinations that cannot happen becomes a union with a `stage` or
  `kind` field (`Pairing` in `hooks/register.tsx`). TypeScript `enum` is unavailable
  (`erasableSyntaxOnly`).
- No clarifying parentheses: Biome's formatter removes them (decision 81).
- A hook passed to `on(...)` is written inside the call, in `register` or in a top-level helper
  that receives `on` (`hookCommands`, which keeps `register` under Biome's 75-line cap). The
  engine refuses a hook passed by a name that is neither a top-level function nor an import from
  the mod's own files.
- Enforced at commit and push, over `hooks/` and `tests/`: six ast-grep rules
  (`ast-grep-rules/`: await-as-own-step, one-operator-per-step, mixed-logic-takes-a-name,
  logic-operands-take-names, call-args-no-arithmetic, promise-combinator-takes-a-name), ESLint's
  `max-depth` at 2 and Biome's `noExcessiveNestedCallbacks` at 2.
