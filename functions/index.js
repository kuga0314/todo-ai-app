/* eslint-env node */
/* eslint-disable no-undef */
/**
 * Cloud Functions entry
 * - 作成/更新/削除/設定変更のたびに：再スケジューリング → 即時通知（単発）
 * - 通知・開始・完了の計測を metrics/ に記録（algoVariant はユーザー設定で補正）
 * - 02:00の一括再スケジュール
 * - FCMトピック購読
 */
const functions = require("firebase-functions/v1");
const admin     = require("firebase-admin");
admin.initializeApp();

const REGION = "asia-northeast1";

// ※プロジェクトの配置に合わせてパスは現状どおり "algorithms"
const scheduleAndNotifyUser = require("./algorithms/scheduleAndNotifyUser");
const scheduleShift         = require("./algorithms/scheduleShift");

/* ────────────────────────────────
   0) ユーティリティ
───────────────────────────────── */
async function getUserAlgo(uid, fallback = "proposed") {
  const db = admin.firestore();
  const snap = await db.doc(`users/${uid}/settings/experiment`).get();
  return snap.get("algoVariant") || fallback || "proposed";
}

/* ────────────────────────────────
   1) FCMトークンを /topics/{uid} に購読
───────────────────────────────── */
exports.subscribeToUserTopic = functions
  .region(REGION)
  .firestore
  .document("users/{uid}")
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const data = change.after.exists ? change.after.data() : null;
    if (!data?.fcmToken) return null;
    try {
      await admin.messaging().subscribeToTopic(data.fcmToken, uid);
      console.log(`✔ subscribed token to /topics/${uid}`);
    } catch (err) {
      console.error("subscribeToTopic error:", err);
    }
    return null;
  });

/* ────────────────────────────────
   2) todos onCreate / onDelete → 再計算＋即時通知＋計測
      ※ algoVariant はユーザー設定で補正してから記録
───────────────────────────────── */
exports.onTodoCreate = functions
  .region(REGION)
  .firestore
  .document("todos/{id}")
  .onCreate(async (snap) => {
    const t = snap.data(); if (!t?.userId) return null;

    // ユーザー設定で algoVariant を確定（新規タスクに未設定でも整合を取る）
    const userAlgo = await getUserAlgo(t.userId, t.algoVariant);
    if (t.algoVariant !== userAlgo) {
      await snap.ref.update({ algoVariant: userAlgo });
    }

    await scheduleAndNotifyUser(t.userId);

    await logMetric({
      uid: t.userId,
      taskId: snap.id,
      algo: userAlgo,
      event: "create",
      task: { ...t, algoVariant: userAlgo },
    });
    return null;
  });

exports.onTodoDelete = functions
  .region(REGION)
  .firestore
  .document("todos/{id}")
  .onDelete(async (snap) => {
    const t = snap.data(); if (!t?.userId) return null;

    await scheduleAndNotifyUser(t.userId);

    const userAlgo = await getUserAlgo(t.userId, t.algoVariant);
    await logMetric({
      uid: t.userId,
      taskId: snap.id,
      algo: userAlgo,
      event: "delete",
      task: { ...t, algoVariant: userAlgo },
    });
    return null;
  });

/* ────────────────────────────────
   3) todos onUpdate → 通知/開始/完了の計測 & 必要時のみ再計算
      ※ algoVariant が未設定ならユーザー設定で補完
───────────────────────────────── */
exports.onTodoUpdate = functions
  .region(REGION)
  .firestore
  .document("todos/{id}")
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after  = change.after.data();
    const uid    = after?.userId;
    if (!uid) return null;

    const now = admin.firestore.Timestamp.now();

    const clientFields = [
      "text","deadline","scale","priority","estimatedMinutes","buffer","completed"
    ];
    const clientChanged = clientFields.some(
      (f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])
    );

    // ユーザー設定を使って algoVariant を確定（未設定時のみ読みに行く）
    let algo = after.algoVariant;
    if (!algo) algo = await getUserAlgo(uid, "proposed");

    // 3-0) 通知イベント：lastNotifiedAt の変化で notify を記録
    const tsBefore = before?.lastNotifiedAt?.toMillis?.() ?? null;
    const tsAfter  = after?.lastNotifiedAt?.toMillis?.()  ?? null;
    if (tsAfter && tsAfter !== tsBefore && after.notified === true) {
      await logMetric({
        uid, taskId: change.after.id,
        algo, event: "notify",
        ts: after.lastNotifiedAt,
        task: after
      });
    }

    // 3-1) “開始”の近似：通知から30分以内の最初の更新で startedAt を刻む＆計測
    const THIRTY_MIN = 30 * 60 * 1000;
    if (!after.startedAt && after.lastNotifiedAt && clientChanged) {
      const dt = now.toMillis() - after.lastNotifiedAt.toMillis();
      if (dt >= 0 && dt <= THIRTY_MIN) {
        await change.after.ref.update({ startedAt: now });
        await logMetric({
          uid, taskId: change.after.id,
          algo, event: "start", ts: now, task: after
        });
      }
    }

    // 3-2) 完了イベント（★修正：completedAt を刻んでから記録）
    if (!before.completed && after.completed) {
      await change.after.ref.update({ completedAt: now });  // ← 追加
      await logMetric({
        uid, taskId: change.after.id,
        algo, event: "complete", ts: now, task: after
      });
    }

    // 3-3) 影響のある変更のみ再計算
    if (clientChanged) {
      await scheduleAndNotifyUser(uid);
    }
    return null;
  });

/* ────────────────────────────────
   4) 設定変更時（experiment）→ 全タスク再計算 → （必要なら）即時通知
───────────────────────────────── */
exports.onExperimentChange = functions
  .region(REGION)
  .firestore
  .document("users/{uid}/settings/experiment")
  .onWrite(async (_chg, ctx) => {
    const { uid } = ctx.params;
    await scheduleAndNotifyUser(uid);
    return null;
  });

/* ────────────────────────────────
   5) 02:00に一括再スケジュール（保険）
───────────────────────────────── */
exports.scheduleShiftDaily = functions
  .region(REGION)
  .pubsub
  .schedule("0 2 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(() => scheduleShift());

/* ────────────────────────────────
   6) 計測ユーティリティ（metrics/ へ1行）
───────────────────────────────── */
async function logMetric({ uid, taskId, algo, event, ts, task }) {
  const db = admin.firestore();
  const now = ts || admin.firestore.Timestamp.now();

  const E = task?.estimatedMinutes ?? null;
  const B = task?.buffer ?? 0.3;
  const D = task?.deadline ?? null;
  const S = task?.startRecommend ?? null;

  // L = D - E*(1+B)
  const L = (D && E)
    ? admin.firestore.Timestamp.fromDate(
        new Date(D.toDate() - E * (1 + B) * 60000)
      )
    : null;

  await db.collection("metrics").add({
    uid, taskId, algoVariant: algo, event, ts: now,
    E, B, D, S, L,
    scale: task?.scale ?? null,
    priority: task?.priority ?? null,
  });
}


/* ────────────────────────────────
   7) scheduleAndNotifyUser.js のエクスポート
───────────────────────────────── */
exports.recalcOnWrite = require("./algorithms/scheduleAndNotifyUser").recalcOnWrite;
exports.recomputeSchedule = require("./algorithms/scheduleAndNotifyUser").recomputeSchedule;
