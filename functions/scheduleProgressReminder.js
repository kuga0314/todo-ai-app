/* eslint-env node */
/* global Intl */
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const msg = admin.messaging();

/** Asia/Tokyo の "HH:mm" を返す */
function nowHHmmTokyo() {
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // "HH:mm" 形式を得る
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find(p => p.type === "hour")?.value ?? "00";
  const mm = parts.find(p => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

/** Asia/Tokyo の今日を YYYY-MM-DD */
function todayKeyTokyo() {
  const fmt = new Intl.DateTimeFormat("sv-SE", { // ISO風 "YYYY-MM-DD"
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "YYYY-MM-DD" 形式
  return fmt.format(new Date());
}

/** 1ユーザーの“今日の実績サマリー”を作る */
async function buildTodaySummary(uid, dateKey) {
  const snap = await db.collection("todos").where("userId", "==", uid).get();
  let tasksWithToday = 0;
  let minutesToday = 0;
  let minutesTotal = 0;

  snap.forEach(d => {
    const t = d.data() || {};
    const logs = t.actualLogs || {};
    const today = Number(logs[dateKey]) || 0;
    if (today > 0) tasksWithToday++;
    minutesToday += today;
    minutesTotal += Number(t.actualTotalMinutes || 0);
  });

  // 文面
  let body;
  if (minutesToday > 0) {
    body = `今日の実績: ${tasksWithToday}件 ${minutesToday}分（累計 ${minutesTotal}分）。進捗を確認しましょう。`;
  } else {
    body = "今日は未入力です。取り組んだ時間を記録しましょう。";
  }
  return { body, tasksWithToday, minutesToday, minutesTotal };
}

/**
 * 日次進捗リマインド
 * - 1分ごとに起動して Asia/Tokyo の "HH:mm" と一致ユーザーへ配信
 * - /progress への導線付き
 */
exports.scheduleProgressReminder = onSchedule("every 1 minutes", async () => {
  const hhmm = nowHHmmTokyo();
  const dateKey = todayKeyTokyo();

  const usersSnap = await db.collection("users").get();
  const sendOps = [];

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const settingsRef = db.doc(`users/${uid}/settings/notification`);
    const sSnap = await settingsRef.get();
    if (!sSnap.exists) continue;

    const s = sSnap.data() || {};
    if (!s.progressReminderTime) continue;

    if (s.progressReminderTime === hhmm) {
      // サマリーを作って送信
      const summary = await buildTodaySummary(uid, dateKey);
      const payload = {
        notification: {
          title: "日次進捗リマインド",
          body: summary.body,
        },
        data: {
          link: "/progress",
          type: "progress_reminder",
          dateKey,
        },
        topic: uid, // FCM: ユーザーIDで購読している想定
      };
      sendOps.push(msg.send(payload).catch(err => {
        console.error("FCM send failed", uid, err);
      }));
    }
  }

  await Promise.all(sendOps);
  return { ok: true, at: hhmm, usersChecked: usersSnap.size, sent: sendOps.length };
});
