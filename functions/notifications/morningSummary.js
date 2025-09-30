/* eslint-env node */
/* eslint-disable no-undef */

const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const { dayKeyIso, toJst } = require("../algorithms/timeWindows");

function parseTimeToMinutes(hhmm) {
  if (typeof hhmm !== "string") return null;
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function formatDurationMinutes(minutes) {
  const min = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}時間${m}分`;
  if (h > 0) return `${h}時間`;
  return `${m}分`;
}

function buildSummaryBody(assignments, totalMinutes) {
  if (!Array.isArray(assignments) || assignments.length === 0) return "";
  const top = assignments.slice(0, 3).map((a) => {
    const dur = formatDurationMinutes(a.minutes);
    const title = (a.text || "無題").trim() || "無題";
    return `${title} ${dur}`;
  });
  const rest = assignments.length > 3 ? ` / 他${assignments.length - 3}件` : "";
  const totalText = formatDurationMinutes(totalMinutes);
  return `合計${totalText}: ${top.join(" / ")}${rest}`;
}

async function dispatchMorningSummaries() {
  const now = new Date();
  const jstNow = toJst(now);
  const currentMinutes = jstNow.getHours() * 60 + jstNow.getMinutes();
  const todayKey = dayKeyIso(now);
  const windowMinutes = 5;

  const usersSnap = await db.collection("users").get();
  const messaging = admin.messaging();

  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    const data = doc.data() || {};
    const token = data.fcmToken;
    if (!token) continue;

    const notifSnap = await db.doc(`users/${uid}/settings/notification`).get();
    if (!notifSnap.exists) continue;
    const notif = notifSnap.data() || {};
    if (notif.mode !== "morningSummary") continue;
    const scheduleMinutes = parseTimeToMinutes(notif.morningTime || "08:00");
    if (!Number.isFinite(scheduleMinutes)) continue;
    const diff = currentMinutes - scheduleMinutes;
    if (diff < 0 || diff >= windowMinutes) continue;

    const planRef = db.doc(`users/${uid}/dailyPlans/${todayKey}`);
    const planSnap = await planRef.get();
    if (!planSnap.exists) continue;
    const plan = planSnap.data() || {};
    const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
    if (!assignments.length) continue;

    if (plan.lastSentDate === todayKey) continue;

    const body = buildSummaryBody(assignments, plan.totalMinutes || 0);
    const title = "今日の学習プラン";

    try {
      await messaging.send({
        token,
        notification: {
          title,
          body,
        },
        data: {
          type: "morningSummary",
          date: todayKey,
          totalMinutes: String(plan.totalMinutes || 0),
        },
      });

      await planRef.set({
        lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSentDate: todayKey,
      }, { merge: true });
<<<<<<< ours
=======

      const todoIds = [...new Set(assignments.map((a) => a.todoId).filter(Boolean))];
      if (todoIds.length) {
        const batch = db.batch();
        const sentAt = admin.firestore.FieldValue.serverTimestamp();
        todoIds.forEach((todoId) => {
          batch.set(db.doc(`todos/${todoId}`), {
            morningSummaryNotified: true,
            morningSummaryLastDate: todayKey,
            morningSummaryNotifiedAt: sentAt,
          }, { merge: true });
        });
        await batch.commit();
      }
>>>>>>> theirs
    } catch (error) {
      console.error("morning summary send failed", uid, error);
    }
  }
}

module.exports = { dispatchMorningSummaries, buildSummaryBody, formatDurationMinutes };
