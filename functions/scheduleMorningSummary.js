/* eslint-env node */
/* global Intl */
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { extractFcmTokens, isInvalidFcmTokenError, removeFcmToken } = require("./fcmTokens");

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

function selectMorningPlan(tasks, appSettings) {
  const capDefault = 120;
  const cap = Number.isFinite(Number(appSettings?.dailyCap))
    ? Number(appSettings.dailyCap)
    : capDefault;

  const today = new Date();
  const candidates = [];

  for (const t of tasks) {
    const E = Number(t.estimatedMinutes) || 0;
    const A = Number(t.actualTotalMinutes) || 0;
    if (E <= 0 || A >= E) continue;

    const R = Math.max(0, E - A);
    const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;

    const deadline = t.deadline instanceof Date ? t.deadline : null;
    if (!deadline) continue;

    const createdAt = t.createdAt instanceof Date ? t.createdAt : today;
    const totalDays = Math.max(1, Math.ceil((deadline - createdAt) / 86400000));
    const elapsed = Math.max(0, Math.ceil((today - createdAt) / 86400000));
    const ideal = Math.min(1, elapsed / totalDays);
    const actual = Math.min(1, A / E);
    const lag = ideal - actual;

    if (lag <= 0) continue;

    candidates.push({
      id: t.id,
      text: t.text || "（無題）",
      R,
      required,
      lag,
      deadlineTs: deadline.getTime(),
    });
  }

  candidates.sort(
    (a, b) =>
      b.lag - a.lag ||
      b.required - a.required ||
      a.deadlineTs - b.deadlineTs
  );

  let used = 0;
  const plan = [];
  for (const c of candidates) {
    const required = Math.max(0, c.required);
    const R = c.R;
    const need = Math.min(required, R, Math.max(0, cap - used));
    if (need <= 0) continue;
    plan.push({
      id: c.id,
      text: c.text,
      todayMinutes: Math.round(need),
      required: c.required,
      deadlineTs: c.deadlineTs,
    });
    used += need;
    if (used >= cap || plan.length >= 3) break;
  }

  if (plan.length === 0) {
    const pending = tasks
      .map((t) => {
        const E = Number(t.estimatedMinutes) || 0;
        const A = Number(t.actualTotalMinutes) || 0;
        if (E <= 0 || A >= E) return null;
        const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;
        const deadline = t.deadline instanceof Date ? t.deadline : null;
        if (!deadline) return null;
        return {
          id: t.id,
          text: t.text || "（無題）",
          required,
          deadlineTs: deadline.getTime(),
        };
      })
      .filter(Boolean);

    pending.sort((a, b) => a.deadlineTs - b.deadlineTs || b.required - a.required);
    const sliced = pending.slice(0, 3);
    return {
      items: sliced.map((x) => ({
        id: x.id,
        text: x.text,
        todayMinutes: Math.round(x.required),
        required: x.required,
        deadlineTs: x.deadlineTs,
      })),
      cap,
      used: Math.round(sliced.reduce((s, x) => s + x.required, 0)),
    };
  }

  return { items: plan, cap, used: Math.round(used) };
}

async function buildMorningBody(uid) {
  const todosSnap = await db.collection("todos").where("userId", "==", uid).get();
  const todayKey = todayKeyTokyo();
  const tasks = [];

  todosSnap.forEach((doc) => {
    const t = doc.data() || {};
    const deadline =
      t.deadline?.toDate?.() ??
      (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
    const createdAt =
      t.createdAt?.toDate?.() ??
      (t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : null);

    tasks.push({
      id: doc.id,
      ...t,
      deadline,
      createdAt,
    });
  });

  let appSettings = {};
  try {
    const s = (await db.doc(`users/${uid}/settings/app`).get()).data() || {};
    appSettings = s;
  } catch (e) {
    console.warn("read dailyCap failed", e);
  }

  const plan = selectMorningPlan(tasks, appSettings);

  if (!plan.items.length)
    return {
      title: "朝プラン",
      body: "今日は特に遅れているタスクはありません。",
      dateKey: todayKey,
      plan,
    };

  const total = Math.round(plan.used || 0);
  const bullets = plan.items
    .map((x, i) => `${i + 1}) ${x.text} ${Math.round(x.todayMinutes || 0)}分`)
    .join(" ");

  const body = `今日のプラン: ${plan.items.length}件 / 合計${total}分  ${bullets}`;
  return { title: "朝プラン", body, dateKey: todayKey, plan };
}

function mapPlanItemsForDailyPlan(items = []) {
  return items.map((item, index) => {
    const plannedMinutes = Math.max(
      0,
      Math.round(item.todayMinutes || item.minutes || 0)
    );
    const row = {
      todoId: item.id || item.todoId || null,
      title: (item.text || item.title || "（無題）").trim() || "（無題）",
      plannedMinutes,
      order: index + 1,
    };

    if (Number.isFinite(Number(item.required))) {
      row.requiredMinutes = Math.round(Number(item.required));
    }

    return row;
  });
}

async function saveDailyPlan({ uid, todayKey, plan }) {
  if (!uid || !todayKey || !plan) return;

  const capMinutes = Number.isFinite(Number(plan.cap))
    ? Math.round(Number(plan.cap))
    : null;
  const totalPlannedMinutes = Math.max(0, Math.round(Number(plan.used) || 0));
  const items = mapPlanItemsForDailyPlan(plan.items || []);

  const dailyPlanRef = db
    .collection("users")
    .doc(uid)
    .collection("dailyPlans")
    .doc(todayKey);

  await dailyPlanRef.set(
    {
      date: todayKey,
      capMinutes,
      totalPlannedMinutes,
      items,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/** スケジュール処理本体 */
exports.scheduleMorningSummary = onSchedule("every 1 minutes", async () => {
  const hhmm = nowHHmmTokyo();
  const users = await db.collection("users").get();
  const ops = [];

  for (const u of users.docs) {
    const uid = u.id;
    const data = u.data() || {};
    const sSnap = await db.doc(`users/${uid}/settings/notification`).get();
    if (!sSnap.exists) continue;
    const s = sSnap.data() || {};
    const morningTime = s.morningPlanTime || s.morningSummaryTime;
    if (!morningTime || morningTime !== hhmm) continue;

    const tokens = extractFcmTokens(data);
    if (!tokens.length) continue;

    const { title, body, dateKey, plan } = await buildMorningBody(uid);

    try {
      await saveDailyPlan({ uid, todayKey: dateKey, plan });
    } catch (saveErr) {
      console.error("save daily plan failed", { uid, dateKey, error: saveErr });
    }

    const sendPromise = (async () => {
      let delivered = false;
      const payloadBase = {
        notification: { title, body },
        data: { type: "morning_summary", link: "/?src=morning" },
      };

      for (const token of tokens) {
        try {
          await msg.send({ ...payloadBase, token });
          delivered = true;
        } catch (err) {
          console.error("FCM send failed", uid, err);
          if (isInvalidFcmTokenError(err)) {
            await removeFcmToken({
              db,
              FieldValue: admin.firestore.FieldValue,
              uid,
              token,
              removeLegacy: data.fcmToken === token,
            });
          }
        }
      }

      if (delivered) {
        try {
          const metricsRef = db.doc(`users/${uid}/metrics/${dateKey}`);
          await metricsRef.set(
            {
              [`notifications.sent.morning`]:
                admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } catch (logErr) {
          console.error("morning notification metric update failed", {
            uid,
            dateKey,
            error: logErr,
          });
        }
      }
    })();

    ops.push(sendPromise);
  }

  await Promise.all(ops);
  return { ok: true, hhmm, usersChecked: users.size, sentOps: ops.length };
});
