import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Generated output, not source: `dist` from `npm run build`, `coverage`
  // from `npm run test:coverage`. The coverage reporter emits vendored
  // scripts with `/* eslint-disable */` headers that
  // --report-unused-disable-directives flags as errors.
  { ignores: ['dist', 'coverage'] },
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
