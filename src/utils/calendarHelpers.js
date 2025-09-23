// src/utils/calendarHelpers.js

import { format } from "date-fns";

/** 締切（Firestore Timestamp or Date） */
export const getDeadline = (t) => t?.deadline?.toDate?.() ?? t?.deadline ?? null;
/** 通知予定（Firestore Timestamp or Date） */
export const getNotifyAt = (t) => t?.startRecommend?.toDate?.() ?? t?.startRecommend ?? null;
/** E（所要時間 M） */
export const getEstimatedMinutesE = (t) =>
  Number.isFinite(+t?.estimatedMinutes) ? +t.estimatedMinutes : null;
/** 必要時間（T_req_min） */
export const getReqMinutes = (t) =>
  Number.isFinite(+t?.T_req_min) ? +t.T_req_min : null;

/** ★ 旧 getPriorityLabel → getImportanceLabel */
export const getImportanceLabel = (t) => {
  const v = Number(t?.priority);
  if (v === 1) return "低";
  if (v === 3) return "高";
  return "中";
};

/** ★ 旧 getScaleLabel → getWLabel */
export const getWLabel = (t) => {
  const v = Number(t?.scale);
  if (!Number.isFinite(v)) return "—";
  return String(v); // w は数値そのまま表示
};

/** 日時フォーマット */
export const fmtDateTime = (d) =>
  d ? format(d, "M/d HH:mm") : "—";

/** 調整情報 */
export const adjustInfo = (t) => {
  if (!t?.explain?.pf) return null;
  const raw = getNotifyAt(t);
  const sr = t?.startRecommend?.toDate?.() ?? t?.startRecommend ?? null;
  if (!raw || !sr) return null;
  const diffMin = Math.round((sr - raw) / 60000);
  return {
    raw,
    sr,
    diffMin,
    direction: diffMin >= 0 ? "遅らせ" : "前倒し",
    reasons: t?.explain?.reasons || null,
  };
};
