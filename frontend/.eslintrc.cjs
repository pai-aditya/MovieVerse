module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    // Codebase doesn't use PropTypes; runtime prop validation isn't enforced here.
    'react/prop-types': 'off',
    // Several effects intentionally run with a narrow dependency list.
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
  overrides: [
    {
      // Config files are CommonJS and run in Node, so `require`/`module` are defined.
      files: ['tailwind.config.js', 'postcss.config.js'],
      env: { node: true },
    },
  ],
}
