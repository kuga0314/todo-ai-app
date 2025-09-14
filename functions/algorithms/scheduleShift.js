/* eslint-env node */
/* eslint-disable no-undef */

/**
 * scheduleShift.js
 * - 修正版PERT + 信頼範囲（±σ）
 * - riskMode: "safe"(+1σ) | "mean"(0σ) | "challenge"(-1σ)
 * - 許可時間帯の丸めは timeWindows に委譲
 */
const admin = require("firebase-admin");
const { modifiedPERT, deriveOMPW } = require("./pert");
const { clampToAllowedWindowNoDelay } = require("./timeWindows");

// 例: 優先度係数（必要なら調整）
const PRIORITY_FACTOR = { high: 1.15, mid: 1.0, low: 0.9 };

// リスクモード → kσ
function kFromRiskMode(riskMode) {
  if (riskMode === "safe") return +1;
  if (riskMode === "challenge") return -1;
  return 0; // mean
}

/** 必要時間（分） T_req = (TEw + kσ) * (1+B) * PriorityFactor */
function computeRequiredMinutes(task, exp) {
  const priorityKey =
    task.priority === "high" || task.priority === "mid" || task.priority === "low"
      ? task.priority
      : "mid";

  const kSigma = kFromRiskMode(exp?.riskMode || "mean");
  const bufferRate = typeof task.buffer === "number" ? task.buffer : 0;

  const E = Math.max(1, Number(task.estimatedMinutes || task.E || 0));
  const scale = task.scale || task.uncertainty || 3;

  const { O, M, P, w, sigma } = deriveOMPW(E, scale);
  const TEw = modifiedPERT(O, M, P, w);

  let core = TEw + kSigma * sigma;
  if (!isFinite(core) || core <= 0) core = Math.max(1, E);

  const pf = PRIORITY_FACTOR[priorityKey] ?? 1.0;
  const Treq = Math.max(1, Math.round(core * (1 + bufferRate) * pf));

  return { Treq, explain: { O, M, P, w, sigma, TEw, kSigma, bufferRate, pf } };
}

/** startRecommend を決定（締切から逆算 → 許可時間帯へ丸め） */
function computeStartRecommendISO(task, Treq, userSettings) {
  const deadlineIso = task.deadlineIso || task.deadline || task.deadlineISO;
  if (!deadlineIso) return null;

  const deadline = new Date(deadlineIso);
  if (Number.isNaN(deadline.getTime())) return null;

  const startCandidate = new Date(deadline.getTime() - Treq * 60 * 1000);

  const { notifyWindow, workHours, timezone } = userSettings || {};
  const clamped = clampToAllowedWindowNoDelay(
    startCandidate,
    notifyWindow,
    workHours,
    timezone
  );

  return clamped?.toISOString?.() || startCandidate.toISOString();
}

/** メイン：タスク配列 → startRecommend / explain を付与して返す */
function scheduleShift(tasks, userSettings, experimentSettings) {
  if (!Array.isArray(tasks)) return [];

  const exp = {
    algoVariant: experimentSettings?.algoVariant || "modifiedPERT",
    riskMode: experimentSettings?.riskMode || "mean",
  };

  return tasks.map((t) => {
    try {
      const { Treq, explain } = computeRequiredMinutes(t, exp);
      const startRecommendIso = computeStartRecommendISO(t, Treq, userSettings);

      let startRecommendTs = null;
      if (startRecommendIso) {
        startRecommendTs = admin.firestore.Timestamp.fromDate(
          new Date(startRecommendIso)
        );
      }

      const updated = {
        ...t,
        T_req_min: Treq,
        // ISO文字列と Timestamp の両方を保存（互換性確保）
        startRecommendIso,
        startRecommend: startRecommendTs,
        explain: {
          ...(t.explain || {}),
          variant: exp.algoVariant,
          riskMode: exp.riskMode,
          ...explain,
        },
      };
      return updated;
    } catch (e) {
      return { ...t, explain: { ...(t.explain || {}), error: String(e) } };
    }
  });
}

module.exports = { scheduleShift, computeRequiredMinutes, computeStartRecommendISO };
