const MS_PER_DAY = 1000 * 60 * 60 * 24;

const toDateSafe = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime())
      ? converted
      : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    const tsDate = new Date(value.seconds * 1000);
    return Number.isNaN(tsDate.getTime()) ? null : tsDate;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const jstDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const parseDateKey = (key) => {
  const [y, m, d] = String(key)
    .split("-")
    .map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(y, m - 1, d);
};

const roundUpToFiveMinutes = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.ceil(Math.ceil(value) / 5) * 5;
};

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

const resolveRiskGuidance = ({
  deadline,
  remainingMinutes,
  riskKey,
  spi,
  now = new Date(),
}) => {
  const deadlineDate = toDateSafe(deadline);
  const remaining = Number.isFinite(remainingMinutes) ? Math.max(0, Math.round(remainingMinutes)) : null;
  const canCalculateGuidance = remaining != null && remaining > 0 && !!deadlineDate;

  let requiredMinutesForWarn = null;
  let requiredMinutesForOk = null;
  let requiredPerDay = null;

  if (canCalculateGuidance) {
    const today = parseDateKey(jstDateKey(now));
    const diffMs = deadlineDate.getTime() - today.getTime();
    const diffDaysRaw = diffMs / MS_PER_DAY;
    const daysLeft = Math.max(1, Math.ceil(diffDaysRaw));

    const basePerDay = remaining / daysLeft;
    requiredPerDay = basePerDay;

    const clampToRemaining = (value) => {
      const rounded = roundUpToFiveMinutes(value);
      if (rounded == null) return null;
      return Math.min(rounded, remaining);
    };

    const spiValue = Number.isFinite(spi) ? spi : null;
    let targetWarnSpi = null;
    let targetOkSpi = null;

    if (spiValue != null) {
      if (spiValue < 0.8) {
        targetWarnSpi = 0.8;
        targetOkSpi = 1;
      } else if (spiValue < 1) {
        targetOkSpi = 1;
      }
    } else if (riskKey === "late") {
      targetWarnSpi = 0.8;
      targetOkSpi = 1;
    } else if (riskKey === "warn") {
      targetOkSpi = 1;
    }

    const computeRequired = (targetSpi) => {
      if (!Number.isFinite(targetSpi) || targetSpi <= 0) return null;
      return clampToRemaining(basePerDay * targetSpi);
    };

    requiredMinutesForWarn = computeRequired(targetWarnSpi);
    requiredMinutesForOk = computeRequired(targetOkSpi);
  }

  return {
    requiredPerDay,
    requiredMinutesForWarn,
    requiredMinutesForOk,
  };
};

export {
  toDateSafe,
  jstDateKey,
  roundUpToFiveMinutes,
  normalizeRisk,
  resolveRiskGuidance,
};
