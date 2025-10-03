/* eslint-env node */

// JST/UTC
const JST_OFF = 9 * 3600 * 1000;
const toJst = (d) => new Date(d.getTime() + JST_OFF);
const toUtc = (d) => new Date(d.getTime() - JST_OFF);

const toDate = (d) => {
  if (!d) return null;
  if (typeof d?.toDate === "function") return d.toDate();
  if (d instanceof Date) return d;
  if (typeof d === "string" || typeof d === "number") {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
};

// リマインド間隔の目安
const remindMin = (p = 3, s = 3) => {
  const u = (p ?? 3) * 1.2 + (s ?? 3) * 0.8;
  return u >= 8 ? 30 : u >= 5 ? 60 : 120;
};

// r（分散比）— 優先度×規模
function bufferRatio(priority, scale) {
  const p = Math.max(0, Math.min(1, ((Number(priority) || 2) - 1) / 2));
  const s = Math.max(0, Math.min(1, ((Number(scale) || 3) - 1) / 4));
  const a = 0.20, b = 0.25, c = 0.15;
  const rMin = 0.10, rMax = 0.80;
  let r = a + b * p + c * s;
  if (r < rMin) r = rMin;
  if (r > rMax) r = rMax;
  return r;
}

// "HH:MM" → 分
const hhmmToMin = (s) => {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return Math.max(0, Math.min(24 * 60, h * 60 + m));
};

// 与日（UTC）に対する許可ウィンドウ（通知×作業時間の積集合）
function dayAllowedWindowUtc(dUtc, notifyWindow, workHours) {
  const j = toJst(dUtc);
  const w = j.getDay();
  const isWeekend = (w === 0 || w === 6);
  if (isWeekend && workHours?.skipWeekends) {
    const js = new Date(j.getFullYear(), j.getMonth(), j.getDate(), 0, 0, 0, 0);
    return { startUtc: toUtc(js), endUtc: toUtc(js), empty: true };
  }
  const notif = isWeekend ? notifyWindow?.weekend : notifyWindow?.weekday;
  const nStart = hhmmToMin(notif?.start ?? "00:00");
  const nEnd   = hhmmToMin(notif?.end   ?? "24:00");

  const wh = isWeekend ? (workHours?.weekend ?? workHours?.weekday) : workHours?.weekday;
  const wStart = hhmmToMin(wh?.start ?? "00:00");
  const wEnd   = hhmmToMin(wh?.end   ?? "24:00");

  const startMin = Math.max(nStart ?? 0, wStart ?? 0);
  const endMin   = Math.min(nEnd   ?? 24 * 60, wEnd   ?? 24 * 60);

  const y = j.getFullYear(), m = j.getMonth(), d = j.getDate();
  if (!(startMin < endMin)) {
    const js = new Date(y, m, d, 0, 0, 0, 0);
    return { startUtc: toUtc(js), endUtc: toUtc(js), empty: true };
  }
  const js = new Date(y, m, d, Math.floor(startMin / 60), startMin % 60, 0, 0);
  const je = new Date(y, m, d, Math.floor(endMin / 60), endMin % 60, 0, 0);
  return { startUtc: toUtc(js), endUtc: toUtc(je), empty: false };
}

// 許可ウィンドウへの「遅らせない」丸め
function clampToAllowedWindowNoDelay(date, notifyWindow, workHours) {
  const jst = toJst(date);
  const { startUtc, endUtc, empty } = dayAllowedWindowUtc(date, notifyWindow, workHours);
  if (empty) return new Date(startUtc);
  if (date < startUtc) return new Date(startUtc);
  if (date > endUtc)   return new Date(endUtc);
  return new Date(jst.getTime() - JST_OFF);
}

// 日付キー/週末判定/キャパ用
const dayKeyJst = (dUtc) => { const j = toJst(dUtc); j.setHours(0, 0, 0, 0); return j.getTime(); };
const isWeekendUtc = (dUtc) => { const j = toJst(dUtc); const w = j.getDay(); return w === 0 || w === 6; };

const dayKeyIso = (dUtc) => {
  const j = toJst(dUtc);
  j.setHours(0, 0, 0, 0);
  const yyyy = j.getFullYear();
  const mm = String(j.getMonth() + 1).padStart(2, "0");
  const dd = String(j.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

function dayCapacityMinutes(dateUtc, dailyCapacityByDOW) {
  if (!dailyCapacityByDOW) return null;
  const dow = toJst(dateUtc).getDay();
  const minutes = dailyCapacityByDOW?.[dow];
  if (!Number.isFinite(minutes)) return null;
  return Math.max(0, Number(minutes));
}

function dayStartSlotUtc(dateUtc, notifyWindow, workHours) {
  const window = dayAllowedWindowUtc(dateUtc, notifyWindow, workHours);
  if (window.empty) return { ...window };
  return {
    startUtc: new Date(window.startUtc),
    endUtc: new Date(window.endUtc),
    empty: false,
  };
}

module.exports = {
  JST_OFF, toJst, toUtc, toDate,
  remindMin, bufferRatio,
  hhmmToMin, dayAllowedWindowUtc, clampToAllowedWindowNoDelay,
  dayKeyJst, isWeekendUtc, dayKeyIso, dayCapacityMinutes, dayStartSlotUtc,
};
