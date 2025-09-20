// src/utils/calendarHelpers.js
import { format } from "date-fns";

/* ====== 型正規化 ====== */
export const toJsDate = (v) =>
  v?.toDate?.() ??
  (typeof v === "string" || typeof v === "number" ? new Date(v) : null);

export const toDateMaybe = (x) => {
  if (!x) return null;
  if (typeof x.toDate === "function") return x.toDate();
  if (x instanceof Date) return x;
  return null;
};

/* ====== 取得系 ====== */
export const getDeadline = (t) =>
  toJsDate(t.deadline ?? t.due ?? t.dueAt ?? t.limitAt ?? null);

export const getNotifyAt = (t) =>
  toJsDate(t.startRecommend ?? t.notifyAt ?? t.notificationAt ?? null);

// 「E（所要）」= ユーザー入力の estimatedMinutes を優先して取得
export const getEstimatedMinutesE = (t) => {
  const v = t?.estimatedMinutes;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// 想定所要（UI目安用）：T_req、なければEなど
export const getReqMinutes = (t) => {
  const m =
    t.T_req ??
    t.t_req ??
    t.requiredMinutes ??
    t.reqMinutes ??
    t.estimatedMinutes ??
    null;
  if (typeof m === "number") return m;
  if (typeof m === "string") {
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const getPriorityLevel = (t) => {
  const raw = t.priority ?? t.priorityLevel ?? t.priorityLabel ?? null;
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (raw === "高") return 3;
  if (raw === "中") return 2;
  if (raw === "低") return 1;
  return raw;
};
export const getPriorityLabel = (t) => {
  const p = getPriorityLevel(t);
  if (typeof p === "number") return p >= 3 ? "高" : p === 2 ? "中" : "低";
  if (typeof p === "string") return p;
  return null;
};

export const getScaleLevel = (t) => {
  const raw = t.scale ?? t.size ?? t.scaleLevel ?? t.sizeLevel ?? null;
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (raw === "大") return 3;
  if (raw === "中") return 2;
  if (raw === "小") return 1;
  return raw;
};
export const getScaleLabel = (t) => {
  const s = getScaleLevel(t);
  if (typeof s === "number") return s >= 3 ? "大" : s === 2 ? "中" : "小";
  if (typeof s === "string") return s;
  return null;
};

export const fmtDateTime = (d) => (d ? format(d, "M/d HH:mm") : null);

/* ====== 調整情報（startRaw→startRecommend） ====== */
export const adjustInfo = (t) => {
  const sr = toDateMaybe(t.startRecommend);
  const raw = toDateMaybe(t.startRaw);
  if (!sr || !raw) return null;

  const diffMin = Math.round((raw.getTime() - sr.getTime()) / 60000); // +:前倒し / -:繰り下げ
  if (diffMin === 0) return null;

  const ex = t.explain || {};
  const reasons = [];
  // 時間帯（通知可能×作業可能）の丸め
  if (ex.decidedStartIso && ex.latestStartIso_effective) reasons.push("時間帯調整");
  // キャパ/衝突回避で latestAllowed に吸着
  if (ex.nonOverlapGuard?.latestAllowedIso && ex.decidedStartIso) {
    const la = new Date(ex.nonOverlapGuard.latestAllowedIso).getTime();
    const ds = new Date(ex.decidedStartIso).getTime();
    if (la === ds) reasons.push("キャパ/衝突回避");
  }

  return {
    sr,
    raw,
    diffMin,
    direction: diffMin > 0 ? "前倒し" : "繰り下げ",
    reasons: reasons.join(" / "),
  };
};
