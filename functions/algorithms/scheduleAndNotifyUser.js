// functions/scheduleAndNotifyUser.js
// Node 20 / Gen2 前提
/* eslint-env node */
/* eslint-disable no-undef */
const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** ------- 通知計算ユーティリティ ------- */
function computeTEw({ O, M, P, w }) {
  return (O + w * M + P) / (w + 2);
}
function sigmaPERT({ O, P }) {
  return (P - O) / 6;
}
function weightByScale(scale) {
  const map = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1.5 };
  return map[Number(scale) || 3] || 3;
}
function kByRiskMode(riskMode) {
  return riskMode === "safe" ? 1 : riskMode === "challenge" ? -1 : 0;
}
function priorityFactor(p) {
  const map = { 3: 0.9, 2: 1.0, 1: 1.05 };
  return map[Number(p) || 2] || 1.0;
}
function toMs(min) {
  return Number(min || 0) * 60 * 1000;
}
function toIso(d) {
  return d.toISOString();
}

/** Firestore Timestamp / Date / ISO文字列 どれでも読める */
function fromAnyDeadline(payload) {
  const v =
    payload.deadlineIso || payload.deadlineISO || payload.deadline || null;
  if (!v) return null;

  if (typeof v?.toDate === "function") return v.toDate(); // Firestore Timestamp
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  return null;
}

/** 通知時刻計算 */
function computeSchedule(payload) {
  const D = fromAnyDeadline(payload);
  if (!D) return { ok: false, reason: "no-deadline" };

  const E = Number(payload.estimatedMinutes ?? payload.E ?? 0); // 分
  const scale = payload.scale ?? 3;
  const priority = payload.priority ?? 2;
  const riskMode = payload.riskMode ?? "mean";
  const bufferRate = Number(payload.bufferRate_input ?? payload.bufferRate ?? 0);

  const O = Number(payload.O ?? Math.max(E * 0.8, 1));
  const M = Number(payload.M ?? Math.max(E, 1));
  const P = Number(payload.P ?? Math.max(E * 1.5, 1));
  const w = weightByScale(scale);

  const TEw = computeTEw({ O, M, P, w });
  const sigma = sigmaPERT({ O, P });
  const k = kByRiskMode(riskMode);

  const TreqMin = (TEw + k * sigma) * (1 + bufferRate) * priorityFactor(priority);

  const latestStart = new Date(D.getTime() - toMs(TreqMin));
  const startRecommend = latestStart;

  return {
    ok: true,
    startRecommendIso: toIso(startRecommend),
    latestStartIso: toIso(latestStart),
    T_req_min: TreqMin,
    O,
    M,
    P,
    w,
    sigma,
    k,
    bufferRate,
    priority,
    riskMode,
  };
}

/** Firestore 更新処理（共通） */
async function updateTask(ref, out) {
  await ref.update({
    // ISO文字列（解析用）
    startRecommendIso: out.startRecommendIso,
    latestStartIso: out.latestStartIso,

    // Timestamp（UI用）
    startRecommend: admin.firestore.Timestamp.fromDate(
      new Date(out.startRecommendIso)
    ),
    latestStart: admin.firestore.Timestamp.fromDate(
      new Date(out.latestStartIso)
    ),

    // 必要時間
    T_req_min: out.T_req_min,

    // 計算メタ
    calcMeta: {
      O: out.O,
      M: out.M,
      P: out.P,
      w: out.w,
      sigma: out.sigma,
      k: out.k,
      bufferRate: out.bufferRate,
      priority: out.priority,
      riskMode: out.riskMode,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  });
}

/** 実DBパスに合わせる（例: "todos/{taskId}" または "users/{uid}/todos/{taskId}"） */
const DOC_PATH = "todos/{taskId}";

/** Firestore onWrite: タスクが作成/更新されたら再計算 */
exports.recalcOnWrite = onDocumentWritten(DOC_PATH, async (event) => {
  const after = event.data.after?.data();
  if (!after) return;
  if (!after.deadlineIso && !after.deadline && !after.deadlineISO) return;

  const out = computeSchedule(after);
  if (!out.ok) return;

  await updateTask(event.data.after.ref, out);
});

/** Callable: 明示的に再計算 */
exports.recomputeSchedule = onCall(async (req) => {
  const { taskId } = req.data || {};
  if (!taskId) return { ok: false, reason: "no-taskId" };

  const ref = db.collection("todos").doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "not-found" };

  const after = snap.data();
  const out = computeSchedule(after);
  if (!out.ok) return out;

  await updateTask(ref, out);
  return { ok: true, ...out };
});
