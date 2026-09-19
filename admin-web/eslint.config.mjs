import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['.next/**'] }, ...tseslint.configs.recommended, {
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    globals: {
      window: 'readonly',
      localStorage: 'readonly',
      fetch: 'readonly',
      FormData: 'readonly',
    },
  },
});
