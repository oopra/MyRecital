// Flat ESLint config. This app is a browser global-scope script (no modules), so we
// disable no-undef/no-unused-vars (they'd be pure noise across the shared globals) and
// keep the HIGH-SIGNAL rules that catch genuine bugs: duplicate keys/args, unreachable
// code, bad assignments, invalid typeof, etc.
export default [
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script'
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': ['error', 'always'],
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }]
    }
  }
];
