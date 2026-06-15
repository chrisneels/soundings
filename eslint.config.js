import tseslint from 'typescript-eslint';

// The one inviolable principle: the performance is a pure function of the
// score. Math.random() would break that silently, so it is banned outright —
// all randomness must flow through src/rand.ts (seeded, counter-based).
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random() is forbidden. Use rand() from src/rand.ts — every decision must derive from the score seed.',
        },
      ],
    },
  },
);
