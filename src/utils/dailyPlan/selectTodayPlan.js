import * as planEngine from "../../../shared/planEngine";

/** “遅れベース＋キャパ連動”で今日のプランを選定 */
export function selectTodayPlan(todos, appSettings, todayKey, options = {}) {
  const { buildDailyPlan } = planEngine;
  const { mode = "initial", remainingCap = null } = options;
  const capOverride =
    mode === "initial"
      ? null
      : typeof remainingCap === "number" && remainingCap > 0
      ? remainingCap
      : Infinity;

  return buildDailyPlan({
    todos,
    appSettings,
    todayKey,
    capOverride,
    now: new Date(),
    mode,
    remainingCap,
  });
}
