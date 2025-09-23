/* eslint-env node */
/* eslint-disable no-undef */
const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const { scheduleShift } = require("./scheduleShift");

/* ───────── ユーティリティ ───────── */
function toDateMaybe(v) {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return new Date(v);
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function deepEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
/** 入力の指紋（自己ループ抑止用） */
function fingerprintInput(payload) {
  const keys = [
    "deadline","deadlineIso","deadlineISO",
    "estimatedMinutes","E",
    "scale","priority",
    "buffer","bufferRate","bufferRate_input",
    "riskMode","algoVariant",
    "O","M","P","pertWeight",
    "userId",
  ];
  const obj = {};
  for (const k of keys) obj[k] = payload?.[k] ?? null;
  // 締切は ISO で正規化
  const D =
    toDateMaybe(payload?.deadlineIso) ||
    toDateMaybe(payload?.deadlineISO) ||
    toDateMaybe(payload?.deadline);
  obj.deadlineIso = D ? D.toISOString() : null;
  return JSON.stringify(obj);
}

/* ───────── 設定ロード（Settings.jsx 構成に一致） ───────── */
async function loadUserSettings(uid) {
  // 実験（アルゴリズムは UI 側で modifiedPERT 固定）
  const expSnap = await db.doc(`users/${uid}/settings/experiment`).get();
  const experiment = expSnap.exists ? (expSnap.data() || {}) : { algoVariant: "modifiedPERT", riskMode: "mean" };

  // 通知可能時間（weekday/weekend の start/end）
  const nSnap = await db.doc(`users/${uid}/settings/notifyWindow`).get();
  const notifyWindow = nSnap.exists ? (nSnap.data() || {}) : {
    weekday: { start: "08:00", end: "23:00" },
    weekend: { start: "09:00", end: "23:30" },
  };

  // 作業時間帯（無ければデフォルト）
  const wSnap = await db.doc(`users/${uid}/settings/workHours`).get();
  const workHours = wSnap.exists ? (wSnap.data() || {}) : {
    weekday: { start: "09:00", end: "23:00" },
    weekend: { start: "09:00", end: "23:00" },
    skipWeekends: false,
  };

  // 日次キャパ（h）: capacity.weekday / capacity.weekend → DOW ごと分に換算
  const cSnap = await db.doc(`users/${uid}/settings/capacity`).get();
  let capacity = { weekday: 2, weekend: 4 };
  if (cSnap.exists) {
    const d = cSnap.data() || {};
    capacity = { weekday: Number(d.weekday ?? 2), weekend: Number(d.weekend ?? 4) };
  }
  const dailyCapacityByDOW = {
    // 0=Sun,1=Mon,...6=Sat
    0: capacity.weekend * 60,
    1: capacity.weekday * 60,
    2: capacity.weekday * 60,
    3: capacity.weekday * 60,
    4: capacity.weekday * 60,
    5: capacity.weekday * 60,
    6: capacity.weekend * 60,
  };

  return { experiment, notifyWindow, workHours, dailyCapacityByDOW };
}

/* ───────── 1ユーザーの全タスクを一括再配置 ───────── */
async function recomputeForUser(uid) {
  const { experiment, notifyWindow, workHours, dailyCapacityByDOW } = await loadUserSettings(uid);

  const snap = await db.collection("todos").where("userId", "==", uid).get();

  const tasks = [];
  const docs = [];
  snap.forEach((docSnap) => {
    const t = docSnap.data() || {};
    const D =
      toDateMaybe(t.deadlineIso) ||
      toDateMaybe(t.deadlineISO) ||
      toDateMaybe(t.deadline);
    if (!D) return; // 締切なしはスキップ

    tasks.push({
      id: docSnap.id,
      text: t.text,
      deadlineIso: D.toISOString(),
      estimatedMinutes: Number(t.estimatedMinutes ?? t.E ?? 0),
      scale: t.scale ?? t.uncertainty ?? 3,
      priority: t.priority ?? 2,                  // 1=低,2=中,3=高
      buffer: Number(t.bufferRate_input ?? t.bufferRate ?? t.buffer ?? 0),
      createdAt: t.createdAt?.toDate?.()?.toISOString?.() || null, // 安定ソート用
      explain: t.explain || null,

      // ★ ここを追加：手入力があればスケジューラに渡す
      O: Number.isFinite(Number(t.O)) ? Number(t.O) : null,
      P: Number.isFinite(Number(t.P)) ? Number(t.P) : null,
      pertWeight: Number.isFinite(Number(t.pertWeight)) ? Number(t.pertWeight) : null,
    });
    docs.push({ id: docSnap.id, ref: docSnap.ref, data: t });
  });

  const updatedList = scheduleShift(
    tasks,
    { notifyWindow, workHours, dailyCapacityByDOW },
    { algoVariant: experiment.algoVariant || "modifiedPERT", riskMode: experiment.riskMode || "mean" }
  );

  // 差分のみ更新
  let updated = 0, skipped = 0;
  const batch = db.batch();

  for (const u of updatedList) {
    const d = docs.find((x) => x.id === u.id);
    if (!d) { skipped++; continue; }

    const prev = d.data || {};
    const prevComparable = {
      startRecommendIso: prev.startRecommendIso ?? null,
      latestStartIso: prev.latestStartIso ?? null,
      T_req_min: prev.T_req_min ?? null,
      explainCore: {
        variant: prev.explain?.variant ?? null,
        riskMode: prev.explain?.riskMode ?? null,
        O: prev.explain?.O ?? null,
        M: prev.explain?.M ?? null,
        P: prev.explain?.P ?? null,
        w: prev.explain?.w ?? null,
        sigma: prev.explain?.sigma ?? null,
        TEw: prev.explain?.TEw ?? null,
        kSigma: prev.explain?.kSigma ?? null,
        bufferRate: prev.explain?.bufferRate ?? null,
        pf: prev.explain?.pf ?? null,
      },
    };
    const nextComparable = {
      startRecommendIso: u.startRecommendIso ?? null,
      latestStartIso: u.latestStartIso ?? null,
      T_req_min: u.T_req_min ?? null,
      explainCore: {
        variant: u.explain?.variant ?? null,
        riskMode: u.explain?.riskMode ?? null,
        O: u.explain?.O ?? null,
        M: u.explain?.M ?? null,
        P: u.explain?.P ?? null,
        w: u.explain?.w ?? null,
        sigma: u.explain?.sigma ?? null,
        TEw: u.explain?.TEw ?? null,
        kSigma: u.explain?.kSigma ?? null,
        bufferRate: u.explain?.bufferRate ?? null,
        pf: u.explain?.pf ?? null,
      },
    };
    if (deepEqual(prevComparable, nextComparable)) { skipped++; continue; }

    batch.update(d.ref, {
      startRecommendIso: u.startRecommendIso ?? null,
      startRecommend: u.startRecommendIso ? admin.firestore.Timestamp.fromDate(new Date(u.startRecommendIso)) : null,
      latestStartIso: u.latestStartIso ?? null,
      latestStart: u.latestStartIso ? admin.firestore.Timestamp.fromDate(new Date(u.latestStartIso)) : null,
      T_req_min: u.T_req_min ?? null,
      explain: u.explain || null,
      calcMeta: {
        ...(u.explain || {}),
        inputFingerprint: fingerprintInput(d.data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
    updated++;
  }

  if (updated > 0) await batch.commit();
  return { ok: true, userId: uid, updated, skipped };
}

/* ───────── Firestore onWrite：同ユーザー全体再計算 ───────── */
const DOC_PATH = "todos/{taskId}";
exports.recalcOnWrite = onDocumentWritten(DOC_PATH, async (event) => {
  const before = event.data.before?.data() || null;
  const after  = event.data.after?.data()  || null;
  if (!after) return;

  // 入力指紋が同じならスキップ（自己ループ抑止）
  const fp = fingerprintInput(after);
  const prevFp = before?.calcMeta?.inputFingerprint || null;
  if (prevFp && prevFp === fp) return;

  const uid = after.userId;
  if (!uid) return;

  await recomputeForUser(uid);
});

/* ───────── Callable：手動で一括再計算 ───────── */
exports.recomputeUser = onCall(async (req) => {
  const { userId } = req.data || {};
  if (!userId) return { ok: false, reason: "no-userId" };
  return await recomputeForUser(userId);
});

/* 互換エクスポート（旧名） */
async function scheduleAndNotifyUser(uid) {
  if (!uid) return { ok: false, reason: "no-userId" };
  return await recomputeForUser(uid);
}
module.exports = { scheduleAndNotifyUser };
