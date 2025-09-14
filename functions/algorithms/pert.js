/* eslint-env node */
/* eslint-disable no-undef */

/**
 * 修正版PERT（Modified PERT）と三点見積もりユーティリティ
 * - modifiedPERT(O, M, P, w): TEw = (O + w*M + P) / (w + 2)
 * - deriveOMPW(E, scale): E（ユーザー見積り, 分）と不確実性レベル(1..5)から O/M/P/w/σ を生成
 */

function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

/** 修正版PERT期待値 */
function modifiedPERT(O, M, P, w) {
  const ww = Number.isFinite(w) ? Number(w) : 4;
  return (O + ww * M + P) / (ww + 2);
}

/** 三点見積もりの派生生成（UIにO/M/Pが無くても動く） */
function deriveOMPW(E, scale = 3) {
  const M = Math.max(1, Math.round(Number(E) || 0)); // 最確
  const s = clamp(Math.round(Number(scale) || 3), 1, 5);

  // 不確実性レベルに応じた幅（M比）
  const spreadByScale = { 1: 0.30, 2: 0.50, 3: 0.80, 4: 1.10, 5: 1.50 };
  const spread = (spreadByScale[s] || 0.8) * M;

  // 非対称スプレッド：O 40% / P 60%
  const O = Math.max(1, M - Math.round(spread * 0.4));
  const P = Math.max(O + 1, M + Math.round(spread * 0.6));

  // σ = (P - O) / 6
  const sigma = (P - O) / 6;

  // Mの重み w：確実（小規模）ほど M 寄り＝大きい
  const wByScale = { 1: 8, 2: 6, 3: 4, 4: 3, 5: 2 };
  const w = wByScale[s] || 4;

  return { O, M, P, w, sigma };
}

module.exports = { modifiedPERT, deriveOMPW };
