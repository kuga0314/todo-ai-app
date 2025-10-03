/* eslint-env node */
/* eslint-disable no-undef */
const admin = require("firebase-admin");
const { onCall } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();

/**
 * 互換用のCallable関数。
 * 以前は「スケジュール＆通知の一括再計算」をしていたが、
 * 研究方針の変更により legacy アルゴリズムを廃止。
 * 現時点では NO-OP（成功応答のみ）。
 */
exports.recomputeUser = onCall(async (req) => {
  const { userId } = req.data || {};
  if (!userId) return { ok: false, reason: "no-userId" };
  return { ok: true, skipped: true, note: "legacy scheduler removed" };
});

/* 旧名互換: scheduleAndNotifyUser(uid) を呼ぶ箇所が残っていても壊さない */
async function scheduleAndNotifyUser(uid) {
  if (!uid) return { ok: false, reason: "no-userId" };
  return { ok: true, skipped: true, note: "legacy scheduler removed" };
}
module.exports = { scheduleAndNotifyUser };
