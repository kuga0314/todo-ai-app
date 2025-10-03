/* eslint-env node */   // ← これを一行目に入れる

module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: { ecmaVersion: 12 },
  extends: ["eslint:recommended"],
  rules: {
    quotes: ["error", "double", { allowTemplateLiterals: true }],
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "require-jsdoc": "off",
  },
};
