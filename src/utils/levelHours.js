/**
 * utils/levelHours.js（移行用・最小残存版）
 * 目的：
 *  - 「規模＝所要時間」誤用を廃止
 *  - 不確実性レベルの辞書とラベル関数だけを提供
 *  - 旧API（levelToMinutes 等）は明示的にエラーで落として依存を早期に発見
 *
 * 使い方：
 *  - UI表示：uncertaintyLabel(level) を使う（1..5 -> "小/中/大/特大/超特大"）
 *  - 内部計算：所要時間Eはユーザー入力をそのまま使用（このファイルでは計算しない）
 */

export const UNCERTAINTY_LEVELS = Object.freeze({
  1: { label: "小",  note: "ばらつき小（M重視）" },
  2: { label: "中",  note: "標準的な不確実性" },
  3: { label: "大",  note: "見積り幅が広い" },
  4: { label: "特大", note: "悲観側を強めに考慮" },
  5: { label: "超特大", note: "極めて不確実" },
});

export function clampUncertaintyLevel(level = 3) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function uncertaintyLabel(level) {
  const lv = clampUncertaintyLevel(level);
  return UNCERTAINTY_LEVELS[lv]?.label ?? "未設定";
}

/* ──────────────────────────────────────────────────────────────
 *  以下は「旧API」：呼ばれたら即座に例外を投げて気づけるようにする
 * （移行完了後、この節ごとファイル削除）
 * ────────────────────────────────────────────────────────────── */
function _deprecated(name) {
  throw new Error(
    `${name} は廃止されました。E（所要時間）はユーザー入力を直接使用してください。` +
    ` 不確実性レベルは PERT の O/P/w 決定にのみ用います。`
  );
}

export function levelToMinutes(/* level */) { _deprecated("levelToMinutes"); }
export function levelToHours(/* level */)   { _deprecated("levelToHours"); }
export function minutesToLevel(/* min */)   { _deprecated("minutesToLevel"); }
export function hoursToLevel(/* h */)       { _deprecated("hoursToLevel"); }
