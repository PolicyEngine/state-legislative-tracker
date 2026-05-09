import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextCoreWebVitals,
  {
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // App-router layouts inject <link rel="stylesheet"> directly so the
    // no-page-custom-font rule (which targets Pages router) doesn't apply.
    files: ['src/app/layout.jsx'],
    rules: {
      '@next/next/no-page-custom-font': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'coverage/**',
    'public/**',
    'scripts/**',
  ]),
]);
