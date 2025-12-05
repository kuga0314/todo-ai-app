import { jstDateKey } from "./logUpdates";

export const DATE_CAP = 365;

export const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const parseDateKey = (key) => {
  const [y, m, d] = key.split("-").map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(y, m - 1, d);
};

export const buildDateRange = (startKey, endKey) => {
  const startDate = parseDateKey(startKey);
  const endDate = parseDateKey(endKey);
  if (!startDate || !endDate) return [];

  const diffDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
  if (diffDays >= DATE_CAP) {
    startDate.setDate(endDate.getDate() - (DATE_CAP - 1));
  }

  const keys = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    keys.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

export const sanitizeLogs = (logs) => {
  const result = {};
  if (!logs || typeof logs !== "object") return result;
  Object.entries(logs).forEach(([key, value]) => {
    const minutes = Number(value);
    if (Number.isFinite(minutes)) {
      result[key] = minutes;
    }
  });
  return result;
};

export const toNumberOrNull = (value) => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const formatMinutes = (minutes) => `${minutes} 分`;

export const formatProgress = (ratio) => {
  if (!Number.isFinite(ratio)) return "—";
  return `${Math.round(Math.max(0, ratio) * 100)}%`;
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime())
      ? converted
      : null;
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const roundUpToFiveMinutes = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.ceil(Math.ceil(value) / 5) * 5;
};

export const resolveRiskDisplay = (todo, series, options = {}) => {
  const normalizeRisk = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (["ok", "warn", "late"].includes(trimmed)) return trimmed;
    if (trimmed === "良好") return "ok";
    if (trimmed === "注意") return "warn";
    if (trimmed === "遅延" || trimmed === "危険" || trimmed === "警戒") return "late";
    return null;
  };

  const risk = normalizeRisk(todo.riskLevel);

  const deadline = toDate(todo.deadline);
  const plannedStart = toDate(todo.plannedStart);
  const now = options.now instanceof Date ? options.now : new Date();
  if (plannedStart && now.getTime() < plannedStart.getTime()) {
    return { riskKey: "none", riskText: "—", isBeforeStart: true };
  }
  const deadlinePassed =
    !!deadline && !todo?.completed && now.getTime() > deadline.getTime();

  let fallback = null;
  if (!risk) {
    const lastPoint = Array.isArray(series) && series.length ? series[series.length - 1] : null;
    const spi = Number(lastPoint?.spi);
    if (Number.isFinite(spi)) {
      if (spi >= 1) fallback = "ok";
      else if (spi >= 0.8) fallback = "warn";
      else fallback = "late";
    }
  }

  const effective = deadlinePassed ? "late" : risk ?? fallback ?? null;

  const riskKey = effective ?? "none";

  const riskText =
    riskKey === "late"
      ? "🔴 遅延"
      : riskKey === "warn"
      ? "🟡 注意"
      : riskKey === "ok"
      ? "🟢 良好"
      : "—";

  const estimatedMinutes = toNumberOrNull(options.estimatedMinutes ?? todo.estimatedMinutes);
  const actualRaw = options.actualMinutes ?? todo.actualTotalMinutes;
  const actualMinutes = toNumberOrNull(actualRaw);
  const actualTotal = actualMinutes != null ? Math.max(0, Math.round(actualMinutes)) : 0;
  const remainingMinutes =
    estimatedMinutes != null ? Math.max(0, Math.round(estimatedMinutes - actualTotal)) : null;

  let requiredMinutesForWarn = null;
  let requiredMinutesForOk = null;
  let requiredPerDay = null;

  const canCalculateGuidance = remainingMinutes != null && remainingMinutes > 0 && !!deadline;

  if (canCalculateGuidance) {
    const today = parseDateKey(jstDateKey(now));
    const diffMs = deadline.getTime() - today.getTime();
    const diffDaysRaw = diffMs / MS_PER_DAY;
    const daysLeft = Math.max(1, Math.ceil(diffDaysRaw));

    const basePerDay = remainingMinutes / daysLeft;
    requiredPerDay = basePerDay;

    const clampToRemaining = (value) => {
      const rounded = roundUpToFiveMinutes(value);
      if (rounded == null) return null;
      return Math.min(rounded, remainingMinutes);
    };

    const okFactor = riskKey === "late" ? 2 : riskKey === "warn" ? 1.5 : 1;

    if (riskKey === "late") {
      requiredMinutesForWarn = clampToRemaining(basePerDay);
      requiredMinutesForOk = clampToRemaining(basePerDay * okFactor);
    } else if (riskKey === "warn") {
      requiredMinutesForWarn = 0;
      requiredMinutesForOk = clampToRemaining(basePerDay * okFactor);
    } else {
      requiredMinutesForWarn = clampToRemaining(basePerDay);
      requiredMinutesForOk = clampToRemaining(basePerDay * okFactor);
    }
  }

  return {
    riskKey,
    riskText,
    remainingMinutes,
    requiredPerDay,
    requiredMinutesForWarn,
    requiredMinutesForOk,
  };
};

export const calculateAverages = (series, windowSize) => {
  if (!series.length) return 0;
  const recent = series.slice(-windowSize);
  const total = recent.reduce((sum, item) => sum + (item.minutes || 0), 0);
  return total / recent.length;
};
