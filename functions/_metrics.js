/* eslint-env node */
/* eslint-disable no-undef */
// functions/_metrics.js
const admin = require("firebase-admin");
module.exports.logMetric = async ({ uid, taskId, algo, event, ts, task }) => {
  const db = admin.firestore();
  const now = ts || admin.firestore.Timestamp.now();
  const E = task?.estimatedMinutes ?? null;
  const B = task?.buffer ?? 0.3;
  const D = task?.deadline ?? null;
  const S = task?.startRecommend ?? null;
  const dailyMinutes = task?.dailyMinutes ?? null;
  const dailyAssignments = Array.isArray(task?.dailyAssignments)
    ? task.dailyAssignments.map((row) => ({
        date: row?.date ?? null,
        minutes: Number.isFinite(Number(row?.minutes))
          ? Math.max(0, Math.round(Number(row.minutes)))
          : 0,
      }))
    : [];
  const dailyPlanGeneratedAt = task?.dailyPlanGeneratedAt ?? null;
  const morningSummaryNotified = !!task?.morningSummaryNotified;
  const morningSummaryLastDate = task?.morningSummaryLastDate ?? null;
  const L = (D && E)
    ? admin.firestore.Timestamp.fromDate(
        new Date(D.toDate() - E * (1 + B) * 60000)
      )
    : null;
  await db.collection("metrics").add({
    uid, taskId, algoVariant: algo ?? "proposed",
    event, ts: now, E, B, D, S, L,
    scale: task?.scale ?? null, priority: task?.priority ?? null,
    dailyMinutes,
    dailyAssignmentCount: dailyAssignments.length,
    dailyAssignments,
    dailyPlanGeneratedAt,
    morningSummaryNotified,
    morningSummaryLastDate,
  });
};
