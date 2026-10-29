import tseslint from 'typescript-eslint';

// The type-aware lane: typescript-eslint's strictest presets plus every extra typed rule this
// mod's code can meet (his ask, 2026-10-28: "jack up as many of the settings as possible except
// the ones that would conflict with stroop phenomenon"). Like `tsc`, it needs the types Claude Code
// lays when it loads the mod.
//
// One owner per rule. Where Biome and typescript-eslint carry the same rule, the syntactic one
// stays in Biome (it runs on every file) and is switched off here; the type-aware one stays here
// and `biome.json`'s override switches Biome's twin off for the mod's folder: require-await
// (useAwait), consistent-type-exports (useExportType), dot-notation (useLiteralKeys),
// prefer-optional-chain (useOptionalChain), only-throw-error (useThrowOnlyError) and
// no-use-before-define (noInvalidUseBeforeDeclaration, which allows hoisted functions). Every rule
// left off or narrowed below says why.

// Engine-owned types: the mod receives them and cannot make them read-only.
const ENGINE_TYPES = [
  {
    from: 'package',
    package: 'claude-code',
    name: [
      'CommandInfo',
      'ConfigRow',
      'EngineInterface',
      'Next',
      'RenderElement',
      'RenderInput',
      'RenderInputOf',
      'SessionAppendInput',
      'TurnCompleteInput',
    ],
  },
  { from: 'package', package: 'claude-code/testing', name: ['Engine', 'On'] },
  { from: 'lib', name: ['Promise'] },
];

// Names the boolean-prefix rule leaves alone, because a prefix would be wrong or impossible:
// - fixed by Claude Code's own types (`immediate`, `interrupted`, `wait`), or by data the mod has
//   already shipped (`enabled`, the saved setting's name; `firstRunSeen`, a key already in the store
//   on installed machines);
// - holding a setting's value that may be `true` or `false` (`value`, `savedAs`): "is" would make the
//   name claim a yes-or-no question it does not ask (the Stroop reason).
const EXEMPT_BOOLEAN_NAMES = '^(immediate|interrupted|wait|enabled|firstRunSeen|value|savedAs)$';

export default tseslint.config(
  {
    ignores: ['**/.claude-plugin/types/**', 'node_modules/**', 'docs/**', 'scripts/**'],
  },
  {
    files: ['plugins/poopstack/**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
    rules: {
      // Biome owns these syntactic twins (biome.json): one report per defect.
      '@typescript-eslint/adjacent-overload-signatures': 'off', // useAdjacentOverloadSignatures
      '@typescript-eslint/no-array-constructor': 'off', // useArrayLiterals
      '@typescript-eslint/no-empty-function': 'off', // noEmptyBlockStatements
      '@typescript-eslint/no-explicit-any': 'off', // noExplicitAny
      '@typescript-eslint/no-extra-non-null-assertion': 'off', // noExtraNonNullAssertion
      '@typescript-eslint/no-extraneous-class': 'off', // noStaticOnlyClass
      '@typescript-eslint/no-invalid-void-type': 'off', // noConfusingVoidType
      '@typescript-eslint/no-misused-new': 'off', // noMisleadingInstantiator
      '@typescript-eslint/no-non-null-assertion': 'off', // noNonNullAssertion
      '@typescript-eslint/no-this-alias': 'off', // noUselessThisAlias
      '@typescript-eslint/no-unnecessary-type-constraint': 'off', // noUselessTypeConstraint
      '@typescript-eslint/no-unsafe-declaration-merging': 'off', // noUnsafeDeclarationMerging
      '@typescript-eslint/no-unused-vars': 'off', // noUnusedVariables
      '@typescript-eslint/no-useless-constructor': 'off', // noUselessConstructor
      '@typescript-eslint/prefer-function-type': 'off', // useShorthandFunctionType
      '@typescript-eslint/prefer-literal-enum-member': 'off', // useLiteralEnumMembers
      '@typescript-eslint/prefer-namespace-keyword': 'off', // useNamespaceKeyword
      'prefer-const': 'off', // useConst
      'prefer-rest-params': 'off', // noArguments

      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowNullableEnum: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      // The code's idiom is `type`; a `type` alias also keeps the implicit index signature a
      // JSON-shaped store value needs.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/prefer-readonly': 'error',
      // `ignoreInferredTypes`: a callback's parameter takes the engine's type by inference (a
      // `$.command.list()` entry), which the mod cannot make read-only. `treatMethodsAsReadonly`: a
      // method is not mutable state, so the engine's method-bearing objects count as read-only.
      '@typescript-eslint/prefer-readonly-parameter-types': [
        'error',
        { allow: ENGINE_TYPES, ignoreInferredTypes: true, treatMethodsAsReadonly: true },
      ],
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/method-signature-style': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-shadow': 'error',
      // Stricter than Biome's noInvalidUseBeforeDeclaration, which allows hoisted functions, so it
      // owns the rule for the mod's folder.
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          // Halving, doubling, counting and indexing read as themselves.
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
      // Declarations only: `({ x } = y)` looks like a new binding but writes an existing variable,
      // a form whose look contradicts what it does (the Stroop reason).
      '@typescript-eslint/prefer-destructuring': [
        'error',
        {
          VariableDeclarator: { array: true, object: true },
          AssignmentExpression: { array: false, object: false },
        },
      ],
      '@typescript-eslint/init-declarations': 'error',
      // Block depth at 2, today's deepest (his page-6 row-3 pick, 2026-10-29): a third level is
      // split into a helper or an early return. Biome has no block-depth rule; it owns the
      // callback twin (noExcessiveNestedCallbacks, biome.json).
      'max-depth': ['error', 2],
      '@typescript-eslint/no-loop-func': 'error',
      '@typescript-eslint/default-param-last': 'error',
      // A boolean's name says it is one (is, has, was, should, can, did, will, are), so a name never
      // reads as the thing rather than a yes-or-no about it.
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['variable', 'parameter', 'property', 'accessor'],
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'was', 'should', 'can', 'did', 'will', 'are'],
          filter: { regex: EXEMPT_BOOLEAN_NAMES, match: false },
        },
      ],
    },
  },
  {
    // `checksVoidReturn.arguments` takes minutes on every call to the engine's `on()`, a generic
    // whose constraint is a union of every event (typescript-eslint issue #13078, open; fix in
    // pull request #13106, open): off only where `on()` is called. Re-enable when the fix ships.
    files: ['plugins/poopstack/hooks/register.tsx', 'plugins/poopstack/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },
  {
    // The engine's contract asks for `interface PluginState`: the mod's state merges into it.
    files: ['plugins/poopstack/types/index.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    // A test's expected values read best as the numbers themselves.
    files: ['plugins/poopstack/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
);
