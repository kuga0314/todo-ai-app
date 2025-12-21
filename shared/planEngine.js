import {
  normalizeRisk,
  resolveRiskGuidance,
  roundUpToFiveMinutes,
  toDateSafe,
} from "./analyticsGuidance";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const ceilToFive = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.ceil(Math.ceil(value) / 5) * 5;
};

const calcLag = ({ E, A, createdAt, deadline, now }) => {
  const created = createdAt || now;
  const totalDays = Math.max(1, Math.ceil((deadline - created) / 86400000));
  const elapsed = Math.max(0, Math.ceil((now - created) / 86400000));
  const ideal = Math.min(1, elapsed / totalDays);
  const actual = Math.min(1, A / E);
  return ideal - actual;
};

const calcScore = ({ lag, R, D }) => {
  const deadlineRisk = 1 / (D + 1);
  const load = R / D;
  return 3 * Math.max(0, lag) + 2 * deadlineRisk + load;
};

const calcRecoverMinutes = ({ todo, E, A, R, D, lag, now }) => {
  const riskKey = normalizeRisk(todo?.riskLevel);
  const guidance = resolveRiskGuidance({
    deadline: todo?.deadline,
    remainingMinutes: R,
    riskKey,
    now,
  });
  const guidanceRecover = guidance?.requiredMinutesForOk;
  const basePerDay = D > 0 ? R / D : R;
  const fallbackRecover = roundUpToFiveMinutes(basePerDay * (lag > 0 ? 2 : 1));
  const rawRecover = guidanceRecover ?? fallbackRecover;
  const required = Number(todo?.requiredPaceAdj ?? todo?.requiredPace ?? 0) || 0;
  const minMinutes = clamp(required, 0, R);
  return clamp(rawRecover ?? minMinutes, minMinutes, R);
};

const buildDailyPlan = ({
  todos = [],
  appSettings = {},
  todayKey = null,
  capOverride = null,
  now = new Date(),
  mode = "initial",
  remainingCap = null,
}) => {
  const capDefault = 120;
  const capFromSettings = Number(appSettings?.dailyCap);
  const baseCap =
    Number.isFinite(capFromSettings) && capFromSettings > 0 ? capFromSettings : capDefault;

  let cap = baseCap;
  if (Number.isFinite(Number(capOverride))) {
    cap = Math.max(0, Math.round(Number(capOverride)));
  } else if (mode !== "initial") {
    if (typeof remainingCap === "number" && remainingCap > 0) {
      cap = remainingCap;
    } else {
      cap = Infinity;
    }
  }

  // 最終安全値：Infinity や 0/負のキャパはデフォルトに戻す
  if (!Number.isFinite(cap) || cap <= 0) {
    cap = baseCap;
  }

  const candidates = [];
  for (const t of todos) {
    const plannedStartAt = toDateSafe(t.plannedStart);
    if (plannedStartAt && plannedStartAt.getTime() > now.getTime()) continue;

    const E = Number(t.estimatedMinutes) || 0;
    const A = Number(t.actualTotalMinutes) || 0;
    if (E <= 0 || A >= E) continue;

    const R = Math.max(0, E - A);
    const deadline = toDateSafe(t.deadline);
    if (!deadline) continue;
    const createdAt = toDateSafe(t.createdAt) || now;

    const lag = calcLag({ E, A, createdAt, deadline, now });
    const D = Math.max(1, Math.ceil((deadline - now) / 86400000));
    const score = calcScore({ lag, R, D });
    const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;
    const recoverMinutes = calcRecoverMinutes({ todo: t, E, A, R, D, lag, now });
    const minMinutes = clamp(required, 0, R);

    candidates.push({
      id: t.id,
      text: t.text || "（無題）",
      R,
      required,
      lag,
      score,
      daysToDeadline: D,
      deadlineTs: deadline.getTime(),
      labelColor: t.labelColor,
      recoverMinutes,
      minMinutes,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.deadlineTs - b.deadlineTs ||
      b.required - a.required
  );

  const selected = [];
  let used = 0;

  // 1st pass: minimum allocation
  for (const c of candidates) {
    if (selected.length >= 3 || used >= cap) break;
    const capRemaining = Math.max(0, cap - used);
    const alloc = Math.min(c.minMinutes, capRemaining);
    selected.push({ ...c, allocated: alloc });
    used += alloc;
  }

  // 2nd pass: grow toward recovery
  if (used < cap) {
    for (const c of selected) {
      if (used >= cap) break;
      const capRemaining = Math.max(0, cap - used);
      const extra = Math.min(Math.max(0, c.recoverMinutes - c.allocated), capRemaining);
      if (extra > 0) {
        c.allocated += extra;
        used += extra;
      }
    }
  }

  // 3rd pass: fill remaining (pull-in) by nearest deadline
  if (used < cap) {
    const byDeadline = [...selected].sort((a, b) => a.deadlineTs - b.deadlineTs);
    for (const c of byDeadline) {
      if (used >= cap) break;
      const capRemaining = Math.max(0, cap - used);
      const extra2 = Math.min(30, Math.max(0, c.R - c.allocated), capRemaining);
      if (extra2 > 0) {
        c.allocated += extra2;
        used += extra2;
      }
    }
  }

  const plan = selected
    .filter((c) => c.allocated > 0)
    .map((c) => ({
      id: c.id,
      text: c.text,
      todayMinutes: Math.round(c.allocated),
      required: c.required,
      labelColor: c.labelColor,
      deadlineTs: c.deadlineTs,
    }))
    .slice(0, 3);

  if (plan.length === 0) {
    const pending = candidates.map((c) => ({
      id: c.id,
      text: c.text,
      required: c.required,
      deadlineTs: c.deadlineTs,
      remaining: c.R,
      labelColor: c.labelColor,
    }));

    const fallbackItems = [];
    let capLeft = cap;
    for (const x of pending) {
      if (fallbackItems.length >= 3 || capLeft <= 0) break;
      const D = Math.max(1, Math.ceil((x.deadlineTs - now.getTime()) / 86400000));
      const base = x.remaining / D;
      const minutes = Math.min(ceilToFive(base), x.remaining, capLeft);
      if (minutes <= 0) continue;
      fallbackItems.push({ ...x, todayMinutes: Math.round(minutes) });
      capLeft -= minutes;
    }

    const fallbackUsed = Math.round(
      fallbackItems.reduce((s, item) => s + (Number(item.todayMinutes) || 0), 0)
    );

    return {
      items: fallbackItems,
      cap,
      used: fallbackUsed,
    };
  }

  return { items: plan, cap, used: Math.round(used) };
};

export {
  buildDailyPlan,
  calcLag,
  calcScore,
  calcRecoverMinutes,
};
