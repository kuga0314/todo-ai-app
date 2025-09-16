/* eslint-env node */
/* eslint-disable no-undef */
const functions = require("firebase-functions/v1");
const admin     = require("firebase-admin");
admin.initializeApp();

const REGION = "asia-northeast1";

const { scheduleAndNotifyUser } = require("./algorithms/scheduleAndNotifyUser");

/* ── 1) todos/{taskId} 作成/更新/削除で再計算 ───────────────── */
exports.onTodoCreate = functions
  .region(REGION)
  .firestore.document("todos/{taskId}")
  .onCreate(async (snap) => {
    const uid = snap.data()?.userId;
    if (!uid) return;
    await scheduleAndNotifyUser(uid);
  });

exports.onTodoUpdate = functions
  .region(REGION)
  .firestore.document("todos/{taskId}")
  .onUpdate(async (change) => {
    const uid = change.after.data()?.userId || change.before.data()?.userId;
    if (!uid) return;
    await scheduleAndNotifyUser(uid);
  });

exports.onTodoDelete = functions
  .region(REGION)
  .firestore.document("todos/{taskId}")
  .onDelete(async (snap) => {
    const uid = snap.data()?.userId;
    if (!uid) return;
    await scheduleAndNotifyUser(uid);
  });

/* ── 2) 毎日02:00 全ユーザー再計算（userId は todos から収集） ── */
exports.nightlyReschedule = functions
  .region(REGION)
  .pubsub.schedule("0 2 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const db = admin.firestore();
    const all = await db.collection("todos").select("userId").get();
    const uids = [...new Set(all.docs.map(d => d.data().userId).filter(Boolean))];
    for (const uid of uids) {
      try { await scheduleAndNotifyUser(uid); } catch (e) { console.error(uid, e); }
    }
  });

/* ── 3) 手動再計算（Callable） ─────────────────────────────── */
exports.recalcAllForUser = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const uid = data?.userId || context.auth?.uid;
    if (!uid) return { ok: false, reason: "no-userId" };
    return await scheduleAndNotifyUser(uid);
  });
