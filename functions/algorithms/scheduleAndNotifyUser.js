/* eslint-env node */
/* eslint-disable no-undef */
const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const { scheduleShift } = require("./scheduleShift");
const { dayKeyIso } = require("./timeWindows");

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
    "w","pertWeight","scale",        // ★ w 関連
    "importance","priority",         // ★ 重要度関連
    "buffer","bufferRate","bufferRate_input",
    "riskMode","algoVariant",
    "O","M","P",
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
  const expSnap = await db.doc(`users/${uid}/settings/experiment`).get();
  const experiment = expSnap.exists ? (expSnap.data() || {}) : { algoVariant: "modifiedPERT", riskMode: "mean" };

  const nSnap = await db.doc(`users/${uid}/settings/notifyWindow`).get();
  const notifyWindow = nSnap.exists ? (nSnap.data() || {}) : {
    weekday: { start: "08:00", end: "23:00" },
    weekend: { start: "09:00", end: "23:30" },
  };

  const wSnap = await db.doc(`users/${uid}/settings/workHours`).get();
  const workHours = wSnap.exists ? (wSnap.data() || {}) : {
    weekday: { start: "09:00", end: "23:00" },
    weekend: { start: "09:00", end: "23:00" },
    skipWeekends: false,
  };

  const cSnap = await db.doc(`users/${uid}/settings/capacity`).get();
  let capacity = { weekday: 2, weekend: 4 };
  if (cSnap.exists) {
    const d = cSnap.data() || {};
    capacity = { weekday: Number(d.weekday ?? 2), weekend: Number(d.weekend ?? 4) };
  }
  const dailyCapacityByDOW = {
    0: capacity.weekend * 60,
    1: capacity.weekday * 60,
    2: capacity.weekday * 60,
    3: capacity.weekday * 60,
    4: capacity.weekday * 60,
    5: capacity.weekday * 60,
    6: capacity.weekend * 60,
  };

  const notifSnap = await db.doc(`users/${uid}/settings/notification`).get();
  const notificationRaw = notifSnap.exists ? (notifSnap.data() || {}) : {};
  const notification = {
    mode: notificationRaw.mode === "morningSummary" ? "morningSummary" : "justInTime",
    morningTime: typeof notificationRaw.morningTime === "string" ? notificationRaw.morningTime : "08:00",
  };

  const defaultsSnap = await db.doc(`users/${uid}/settings/defaults`).get();
  const defaultsRaw = defaultsSnap.exists ? (defaultsSnap.data() || {}) : {};
  const todoDaily = Number(defaultsRaw.todoDailyMinutes);
  const defaults = {
    todoDailyMinutes: Number.isFinite(todoDaily) && todoDaily > 0
      ? Math.max(1, Math.round(todoDaily))
      : null,
  };

  return { experiment, notifyWindow, workHours, dailyCapacityByDOW, notification, defaults };
}

function dateKeyToMillisJst(dateStr) {
  if (typeof dateStr !== "string") return null;
  const iso = `${dateStr}T00:00:00+09:00`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getTime();
}

function buildDailyPlanMap(results, options = {}) {
  const todayKey = options.todayKey ?? dayKeyIso(new Date());
  const todayMs = dateKeyToMillisJst(todayKey) ?? Date.now();
  const horizonDays = Number.isFinite(options.horizonDays) ? options.horizonDays : 30;
  const maxMs = todayMs + horizonDays * 24 * 60 * 60 * 1000;

  const plan = new Map();

  for (const task of results) {
    const assignments = Array.isArray(task.dailyAssignments) ? task.dailyAssignments : [];
    for (const assignment of assignments) {
      const minutes = Number(assignment?.minutes);
      const date = assignment?.date;
      if (!date || !Number.isFinite(minutes) || minutes <= 0) continue;
      const ms = dateKeyToMillisJst(date);
      if (ms == null) continue;
      if (ms < todayMs) continue;
      if (ms > maxMs) continue;

      const record = plan.get(date) || { date, totalMinutes: 0, assignments: [] };
      record.totalMinutes += Math.round(minutes);
      record.assignments.push({
        todoId: task.id,
        text: task.text || "",
        minutes: Math.round(minutes),
        importance: Number(task.importance ?? task.priority) || 2,
        deadlineIso: task.deadlineIso,
      });
      plan.set(date, record);
    }
  }

  for (const record of plan.values()) {
    record.assignments.sort((a, b) => {
      const impDiff = (b.importance || 0) - (a.importance || 0);
      if (impDiff !== 0) return impDiff;
      return (b.minutes || 0) - (a.minutes || 0);
    });
  }

  return plan;
}

async function persistDailyPlanDocs(uid, planMap, mode) {
  const colRef = db.collection(`users/${uid}/dailyPlans`);
  const existingSnap = await colRef.get();
  const batch = db.batch();
  let ops = 0;

  if (mode === "morningSummary") {
    const keepDates = new Set(planMap.keys());
    for (const [date, record] of planMap.entries()) {
      const ref = colRef.doc(date);
      batch.set(ref, {
        date,
        totalMinutes: record.totalMinutes,
        assignments: record.assignments,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      ops += 1;
    }

    existingSnap.forEach((doc) => {
      if (!keepDates.has(doc.id)) {
        batch.delete(doc.ref);
        ops += 1;
      }
    });
  } else {
    existingSnap.forEach((doc) => {
      batch.delete(doc.ref);
      ops += 1;
    });
  }

  if (ops > 0) {
    await batch.commit();
  }
}

/* ───────── 1ユーザーの全タスクを一括再配置 ───────── */
async function recomputeForUser(uid) {
  const {
    experiment,
    notifyWindow,
    workHours,
    dailyCapacityByDOW,
    notification,
    defaults,
  } = await loadUserSettings(uid);

  const snap = await db.collection("todos").where("userId", "==", uid).get();

  const tasks = [];
  const docs = [];
  snap.forEach((docSnap) => {
    const t = docSnap.data() || {};
    const D =
      toDateMaybe(t.deadlineIso) ||
      toDateMaybe(t.deadlineISO) ||
      toDateMaybe(t.deadline);
    if (!D) return;

    tasks.push({
      id: docSnap.id,
      text: t.text,
      deadlineIso: D.toISOString(),
      estimatedMinutes: Number(t.estimatedMinutes ?? t.E ?? 0),

      // ★ w と importance を優先的に正規化
      w: Number.isFinite(Number(t.w)) ? Number(t.w) : (
        Number.isFinite(Number(t.pertWeight)) ? Number(t.pertWeight) :
        (Number.isFinite(Number(t.scale)) ? Number(t.scale) : 3)
      ),
      importance: Number.isFinite(Number(t.importance)) ? Number(t.importance) : (
        Number.isFinite(Number(t.priority)) ? Number(t.priority) : 2
      ),

      buffer: Number(t.bufferRate_input ?? t.bufferRate ?? t.buffer ?? 0),
      createdAt: t.createdAt?.toDate?.()?.toISOString?.() || null,
      explain: t.explain || null,

      O: Number.isFinite(Number(t.O)) ? Number(t.O) : null,
      P: Number.isFinite(Number(t.P)) ? Number(t.P) : null,
      dailyMinutes: Number.isFinite(Number(t.dailyMinutes)) ? Number(t.dailyMinutes) : null,
    });
    docs.push({ id: docSnap.id, ref: docSnap.ref, data: t });
  });

  // 既存タスクに対するスキーママイグレーション（互換用フィールドを補完）
  const migrationBatch = db.batch();
  let migrationOps = 0;
  for (const doc of docs) {
    const src = doc.data || {};
    const patch = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
    if (!has("dailyMinutes")) patch.dailyMinutes = src.dailyMinutes ?? null;
    if (!has("dailyAssignments") || !Array.isArray(src.dailyAssignments)) patch.dailyAssignments = Array.isArray(src.dailyAssignments) ? src.dailyAssignments : [];
    if (!has("dailyPlanGeneratedAt")) patch.dailyPlanGeneratedAt = src.dailyPlanGeneratedAt ?? null;
    if (!has("dailyProgress") || typeof src.dailyProgress !== "object" || src.dailyProgress == null) patch.dailyProgress = {};
    if (!has("assignedMinutes")) patch.assignedMinutes = src.assignedMinutes ?? null;
    if (!has("unallocatedMinutes")) patch.unallocatedMinutes = src.unallocatedMinutes ?? null;
    if (!has("morningSummaryNotified")) patch.morningSummaryNotified = false;
    if (!has("morningSummaryLastDate")) patch.morningSummaryLastDate = src.morningSummaryLastDate ?? null;
    if (!has("morningSummaryNotifiedAt")) patch.morningSummaryNotifiedAt = src.morningSummaryNotifiedAt ?? null;
    if (Object.keys(patch).length > 0) {
      migrationBatch.set(doc.ref, patch, { merge: true });
      migrationOps += 1;
    }
  }
  if (migrationOps > 0) {
    await migrationBatch.commit();
  }

  const updatedList = scheduleShift(
    tasks,
    { notifyWindow, workHours, dailyCapacityByDOW, defaults },
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
      dailyAssignments: prev.dailyAssignments ?? [],
      assignedMinutes: prev.assignedMinutes ?? null,
      unallocatedMinutes: prev.unallocatedMinutes ?? null,
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
      dailyAssignments: u.dailyAssignments ?? [],
      assignedMinutes: u.assignedMinutes ?? null,
      unallocatedMinutes: u.unallocatedMinutes ?? null,
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

    const updatePayload = {
      T_req_min: u.T_req_min ?? null,
      dailyAssignments: u.dailyAssignments ?? [],
      assignedMinutes: u.assignedMinutes ?? null,
      unallocatedMinutes: u.unallocatedMinutes ?? null,
      dailyPlanGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      explain: u.explain || null,
      calcMeta: {
        ...(u.explain || {}),
        notificationMode: notification.mode,
        dailyLimit: Number.isFinite(u._dailyLimit) ? u._dailyLimit : null,
        inputFingerprint: fingerprintInput(d.data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    };

    if (notification.mode === "morningSummary") {
      updatePayload.startRecommendIso = null;
      updatePayload.startRecommend = null;
      updatePayload.latestStartIso = null;
      updatePayload.latestStart = null;
      updatePayload.morningSummaryNotified = false;
    } else {
      updatePayload.startRecommendIso = u.startRecommendIso ?? null;
      updatePayload.startRecommend = u.startRecommendIso
        ? admin.firestore.Timestamp.fromDate(new Date(u.startRecommendIso))
        : null;
      updatePayload.latestStartIso = u.latestStartIso ?? null;
      updatePayload.latestStart = u.latestStartIso
        ? admin.firestore.Timestamp.fromDate(new Date(u.latestStartIso))
        : null;
    }

    batch.update(d.ref, updatePayload);
    updated++;
  }

  if (updated > 0) await batch.commit();

  const planMap = buildDailyPlanMap(updatedList);
  await persistDailyPlanDocs(uid, planMap, notification.mode);

  return { ok: true, userId: uid, updated, skipped };
}

/* ───────── Firestore onWrite：同ユーザー全体再計算 ───────── */
const DOC_PATH = "todos/{taskId}";
exports.recalcOnWrite = onDocumentWritten(DOC_PATH, async (event) => {
  const before = event.data.before?.data() || null;
  const after  = event.data.after?.data()  || null;
  if (!after) return;

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
