/* eslint-env node */
/* global Intl */
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const msg = admin.messaging();

/** "HH:mm"（JST） */
function nowHHmmTokyo() {
  const f = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = f.formatToParts(new Date());
  const hh = p.find((x) => x.type === "hour")?.value ?? "00";
  const mm = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

/** YYYY-MM-DD（JST） */
function todayKeyTokyo() {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

/**
 * 今日取り組むべきタスクを算出する
 * - 条件: 遅れているタスク（実際進捗 < 理想進捗）
 * - 並び順: 遅れ度大きい順 → 必要ペース大きい順 → 締切近い順
 * - キャパ連動: 合計 requiredMinutes が上限(既定120分)を超えない範囲で選ぶ
 */
async function buildMorningBody(uid) {
  const todosSnap = await db.collection("todos").where("userId", "==", uid).get();
  const tasks = [];
  const today = new Date();
  const todayKey = todayKeyTokyo();

  todosSnap.forEach((doc) => {
    const t = doc.data() || {};
    const E = Number(t.estimatedMinutes) || 0;
    const A = Number(t.actualTotalMinutes) || 0;
    if (E <= 0 || A >= E) return;

    const R = Math.max(0, E - A);
    const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0);
    const deadline =
      t.deadline?.toDate?.() ??
      (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
    if (!deadline) return;

    const totalDays = Math.max(
      1,
      Math.ceil((deadline - (t.createdAt?.toDate?.() ?? 0)) / 86400000)
    );
    const startDate = t.createdAt?.toDate?.() ?? new Date(today);
    const elapsed = Math.max(0, Math.ceil((today - startDate) / 86400000));
    const idealProgress = Math.min(1, elapsed / totalDays);
    const actualProgress = Math.min(1, A / E);
    const lag = idealProgress - actualProgress;

    if (lag <= 0) return;

    tasks.push({
      id: doc.id,
      text: t.text || "（無題）",
      R,
      required,
      lag,
      E,
      A,
      deadlineTs: deadline.getTime(),
    });
  });

  tasks.sort(
    (a, b) =>
      b.lag - a.lag ||
      b.required - a.required ||
      a.deadlineTs - b.deadlineTs
  );

  let cap = 120;
  try {
    const s = (await db.doc(`users/${uid}/settings/app`).get()).data() || {};
    if (Number.isFinite(Number(s.dailyCap))) cap = Number(s.dailyCap);
  } catch (e) {
    console.warn("read dailyCap failed", e);
  }

  const plan = [];
  let used = 0;
  for (const t of tasks) {
    const need = Math.min(t.required || 0, t.R, cap - used);
    if (need <= 0) continue;
    plan.push({ ...t, todayMinutes: need });
    used += need;
    if (used >= cap || plan.length >= 3) break;
  }

  if (plan.length === 0) {
    const alt = [];
    todosSnap.forEach((doc) => {
      const t = doc.data() || {};
      const E = Number(t.estimatedMinutes) || 0;
      const A = Number(t.actualTotalMinutes) || 0;
      if (E <= 0 || A >= E) return;
      const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0);
      const deadline =
        t.deadline?.toDate?.() ??
        (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
      if (!deadline) return;
      alt.push({
        text: t.text || "（無題）",
        required,
        deadlineTs: deadline.getTime(),
      });
    });
    alt.sort((a, b) => a.deadlineTs - b.deadlineTs || b.required - a.required);
    plan.push(...alt.slice(0, 3));
  }

  if (plan.length === 0)
    return { title: "朝プラン", body: "今日は特に遅れているタスクはありません。", dateKey: todayKey };

  const total = Math.round(plan.reduce((s, x) => s + (x.todayMinutes || x.required || 0), 0));
  const bullets = plan
    .map((x, i) => `${i + 1}) ${x.text} ${Math.round(x.todayMinutes || x.required)}分`)
    .join(" ");

  const body = `今日のプラン: ${plan.length}件 / 合計${total}分  ${bullets}`;
  return { title: "朝プラン", body, dateKey: todayKey };
}

/** スケジュール処理本体 */
exports.scheduleMorningSummary = onSchedule("every 1 minutes", async () => {
  const hhmm = nowHHmmTokyo();
  const users = await db.collection("users").get();
  const ops = [];

  for (const u of users.docs) {
    const uid = u.id;
    const sSnap = await db.doc(`users/${uid}/settings/notification`).get();
    if (!sSnap.exists) continue;
    const s = sSnap.data() || {};
    if (!s.morningSummaryTime || s.morningSummaryTime !== hhmm) continue;

    const token = (u.data() || {}).fcmToken;
    if (!token) continue;

    const { title, body, dateKey } = await buildMorningBody(uid);

    // 通知送信
    ops.push(
      msg.send({
        token,
        notification: { title, body },
        data: { type: "morning_summary", link: "/?src=morning" },
      })
    );

    // ✅ 送信カウントを記録（metrics）
    const metricsRef = db.doc(`users/${uid}/metrics/${dateKey}`);
    await metricsRef.set(
      {
        [`notifications.sent.morningSummary`]:
          admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await Promise.all(ops);
  return { ok: true, hhmm, usersChecked: users.size, sentOps: ops.length };
});
