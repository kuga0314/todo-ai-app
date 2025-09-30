// src/utils/calendarHelpers.js

import { format, parseISO, addDays } from "date-fns";

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

export const getDailyAssignments = (t) =>
  Array.isArray(t?.dailyAssignments)
    ? t.dailyAssignments.map((row) => ({
        date: typeof row.date === "string" ? row.date : null,
        minutes: Number.isFinite(Number(row.minutes))
          ? Math.max(0, Math.round(Number(row.minutes)))
          : 0,
      }))
    : [];

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

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const todayKey = () => {
  const now = new Date();
  return dateKey(now);
};

export const dateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const dateFromKey = (key) => {
  if (typeof key !== "string") return null;
  const parsed = parseISO(`${key}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateWithWeekday = (key) => {
  const date = dateFromKey(key);
  if (!date) return key || "";
  const weekday = WEEKDAYS[date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
};

export const sumAssignmentMinutes = (assignments = []) =>
  assignments.reduce((acc, row) => acc + (Number(row.minutes) || 0), 0);

export const findAssignmentForDate = (assignments, key) =>
  (assignments || []).find((row) => row.date === key) || null;

export const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}時間${m}分`;
  if (h > 0) return `${h}時間`;
  return `${m}分`;
};

export const formatAssignmentsSummary = (assignments, limit = 3) => {
  if (!assignments?.length) return "予定なし";
  const pieces = assignments.slice(0, limit).map((row) => {
    const dateLabel = formatDateWithWeekday(row.date);
    const duration = formatMinutes(row.minutes);
    return `${dateLabel} ${duration}`;
  });
  const rest = assignments.length > limit ? ` / 他${assignments.length - limit}日` : "";
  return `${pieces.join(" / ")}${rest}`;
};

export const endOfDayExclusive = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return addDays(date, 1);
};
