import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'

// Single source of truth for "generated, not source": .gitignore. Everything
// git is told to ignore -- `dist` from `npm run build`, `coverage` from
// `npm run test:coverage`, the Playwright artifact directories -- is also
// lint input otherwise, because `npm run lint` runs eslint over the whole
// package. That bites hardest with --report-unused-disable-directives: the
// coverage reporter emits vendored scripts carrying `/* eslint-disable */`
// headers, which that flag reports as errors. Deriving the list here keeps it
// from drifting out of sync with .gitignore;
// src/test/config/eslint-config.test.ts asserts the derivation.
const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url))

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // react-hooks v6+ added React-Compiler-derived rules to "recommended".
      // `set-state-in-effect` flags the fetch-on-mount pattern (set loading
      // state, fetch, set data in an effect) used throughout this codebase;
      // restructuring those data flows is beyond this lint migration, and the
      // rule did not exist in the previous setup (react-hooks v4), so turning
      // it off preserves the old rule intent.
      'react-hooks/set-state-in-effect': 'off',
      'jsx-a11y/alt-text': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
