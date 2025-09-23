/* eslint-env node */
/* eslint-disable no-undef */

/**
 * 修正版PERT（Modified PERT）と三点見積もりユーティリティ
 * - modifiedPERT(O, M, P, w): TEw = (O + w*M + P) / (w + 2)
 * - deriveOMPW(E, w): E（ユーザー見積り, 分）と w（1..5）から O/M/P を生成（O/P未入力時のフォールバック用）
 */

function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

/** 修正版PERT期待値 */
function modifiedPERT(O, M, P, w) {
  const W = Number.isFinite(+w) ? +w : 3; // w が未指定ならデフォルト3
  return (O + W * M + P) / (W + 2);
}

/**
 * O/M/P/w の派生生成
 * - ユーザーが O/P を入力しなかった場合にのみ呼び出す
 * - w は scale ではなくユーザー指定の値を優先
 */
function deriveOMPW(E, w = 3) {
  const M = Math.max(1, Math.round(Number(E) || 0)); // 最確値（必須）
  const W = clamp(Math.round(Number(w) || 3), 1, 5);

  // w を指定しても O/P が無ければ幅を補完するために spread を使う
  const spreadByW = { 1: 0.30, 2: 0.50, 3: 0.80, 4: 1.10, 5: 1.50 };
  const spread = (spreadByW[W] || 0.8) * M;

  // 非対称スプレッド：O 40% / P 60%
  const O = Math.max(1, M - Math.round(spread * 0.4));
  const P = Math.max(O + 1, M + Math.round(spread * 0.6));

  // σ = (P - O) / 6
  const sigma = (P - O) / 6;

  return { O, M, P, w: W, sigma };
}

module.exports = { modifiedPERT, deriveOMPW };
