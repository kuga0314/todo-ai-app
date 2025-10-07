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
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

/** Asia/Tokyo の今日を YYYY-MM-DD */
function todayKeyTokyo() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

/** 1ユーザーの“今日の実績サマリー”を作る */
async function buildTodaySummary(uid, dateKey) {
  const snap = await db.collection("todos").where("userId", "==", uid).get();
  let tasksWithToday = 0;
  let minutesToday = 0;
  let minutesTotal = 0;

  snap.forEach((d) => {
    const t = d.data() || {};
    const logs = t.actualLogs || {};
    const today = Number(logs[dateKey]) || 0;
    if (today > 0) tasksWithToday++;
    minutesToday += today;
    minutesTotal += Number(t.actualTotalMinutes || 0);
  });

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
 * - 通知送信後、users/{uid}/metrics/{dateKey}.notifications.sent.progressReminder を +1
 */
exports.scheduleProgressReminder = onSchedule("every 1 minutes", async () => {
  const hhmm = nowHHmmTokyo();
  const dateKey = todayKeyTokyo();

  const usersSnap = await db.collection("users").get();
  const sendOps = [];

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    // 通知設定を取得
    const sSnap = await db.doc(`users/${uid}/settings/notification`).get();
    if (!sSnap.exists) continue;
    const s = sSnap.data() || {};
    if (!s.progressReminderTime || s.progressReminderTime !== hhmm) continue;

    // トークン取得（なければスキップ）
    const token = (userDoc.data() || {}).fcmToken;
    if (!token) {
      console.warn("No fcmToken; skip progress reminder.", { uid, hhmm });
      continue;
    }

    // 本文生成
    const summary = await buildTodaySummary(uid, dateKey);

    // 通知ペイロード
    const payload = {
      token,
      notification: {
        title: "日次進捗リマインド",
        body: summary.body,
      },
      data: {
        link: "/progress?src=progress", // ← App.jsx側でsrcを拾って記録する
        type: "progress_reminder",
        dateKey,
      },
    };

    // 通知送信 & 送信ログ記録
    const sendPromise = msg
      .send(payload)
      .then(async () => {
        const metricsRef = db.doc(`users/${uid}/metrics/${dateKey}`);
        await metricsRef.set(
          {
            [`notifications.sent.progressReminder`]:
              admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      })
      .catch((err) => {
        console.error("FCM send failed", uid, err);
      });

    sendOps.push(sendPromise);
  }

  await Promise.all(sendOps);
  return { ok: true, at: hhmm, usersChecked: usersSnap.size, sent: sendOps.length };
});
