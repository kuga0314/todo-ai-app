/* eslint-env node */   // Node.js 環境であることを明示
/* eslint-disable no-undef */ // require/module を未定義扱いしない

module.exports = {
  env: {
    node: true,   // Node.js グローバルを有効化
    es6: true,    // ES6 構文をサポート
  },
  parserOptions: {
    ecmaVersion: 2018,
  },
  extends: ["eslint:recommended", "google"],
  rules: {
    quotes: ["error", "double", { allowTemplateLiterals: true }],
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "require-jsdoc": "off", // Googleルールで不要なら無効化
  },
};
