/* eslint-env node */
/* eslint-disable no-undef */
const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

if (!admin.apps.length) admin.initializeApp();

/** JSTのYYYY-MM-DD */
function jstDateKey(d = new Date()) {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(d);
}
function addDays(d, days) {
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + days);
  return nd;
}
function keyToDate(key) {
  const [y, m, d] = (key || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

exports.onTodoStats = onDocumentWritten("todos/{id}", async (event) => {
  const afterSnap = event.data?.after;
  if (!afterSnap?.exists) return; // 削除は無視
  const after = afterSnap.data();
  const ref = afterSnap.ref;

  // 入力（E と 実績ログ）
  const E = Number(after.estimatedMinutes) || 0;
  const logs = after.actualLogs || {}; // { "YYYY-MM-DD": minutes }

  // 累積実績（actualLogs 合計と既存 actualTotalMinutes の大きい方）
  const sumLogs = Object.values(logs).reduce((s, v) => s + (Number(v) || 0), 0);
  const Aprev = Number(after.actualTotalMinutes) || 0;
  const A = Math.max(sumLogs, Aprev);

  // 直近7日の1日平均（ウォームアップ規則）
  // ・作業日数<3 の間は「作業した日数」で割る
  // ・3日以上は通常どおり7で割る
  const today = new Date();
  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const key = jstDateKey(addDays(today, -i));
    last7.push(Number(logs[key]) || 0);
  }
  const sum7 = last7.reduce((s, v) => s + v, 0);
  const workedDays = last7.filter((v) => v > 0).length;
  const denomForPace = Math.max(1, workedDays < 3 ? workedDays : 7);
  const pace7d = sum7 / denomForPace; // 分/日

  // 残量
  const R = Math.max(0, E - A);

  // 残日数・必要ペース・EAC日
  const EPS = 1e-6;
  let requiredPace = 0;
  let eacDate = null;
  let deadline = null;

  if (after.deadline) {
    deadline =
      after.deadline.toDate?.() ??
      (after.deadline.seconds
        ? new Date(after.deadline.seconds * 1000)
        : new Date(after.deadline));
  }

  if (deadline) {
    const ms = deadline.getTime() - today.getTime();
    const D = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24))); // 最低1日
    requiredPace = R > 0 ? R / D : 0;

    const denom = Math.max(EPS, pace7d);
    const daysToFinish = R > 0 ? Math.ceil(R / denom) : 0;
    eacDate = jstDateKey(addDays(today, daysToFinish));
  }

  // SPI
  const spi = requiredPace > EPS ? pace7d / requiredPace : (R === 0 ? 1 : 0);

  // リスク判定（初期は厳しすぎないよう緩和）
  let riskLevel = "ok";
  if (R > 0 && deadline) {
    const eacDt = eacDate ? keyToDate(eacDate) : null;
    const isLate = eacDt && eacDt.getTime() > deadline.getTime();

    if (workedDays < 3) {
      // ウォームアップ中：late は出さず warn に留める
      riskLevel = spi < 0.9 || isLate ? "warn" : "ok";
    } else {
      if (isLate) riskLevel = "late";
      else if (spi < 0.9) riskLevel = "warn";
      else riskLevel = "ok";
    }
  }

  // 丸めた“新しい値”
  const next = {
    actualTotalMinutes: A,
    pace7d: Math.round(pace7d * 10) / 10,
    requiredPace: Math.round(requiredPace * 10) / 10,
    spi: Math.round(spi * 100) / 100,
    eacDate: eacDate, // "YYYY-MM-DD" or null
    riskLevel, // "ok" | "warn" | "late"
  };

  // 既存値（差分更新して再発火ループを防ぐ）
  const prev = {
    actualTotalMinutes: Number(after.actualTotalMinutes) || 0,
    pace7d: Number(after.pace7d) || 0,
    requiredPace: Number(after.requiredPace) || 0,
    spi: Number(after.spi),
    eacDate: after.eacDate ?? null,
    riskLevel: after.riskLevel ?? null,
  };

  // 変化したフィールドだけ更新
  const changed = {};
  for (const k of Object.keys(next)) {
    const a = next[k];
    const b = prev[k];
    const bothNum = typeof a === "number" && typeof b === "number";
    const equal = bothNum ? Math.abs(a - b) < 1e-6 : a === b;
    if (!equal) changed[k] = a;
  }

  // 何も変わらなければ終了（←これでチカチカ回避）
  if (Object.keys(changed).length === 0) return;

  // 何か変わったときだけ timestamp を付与して保存
  changed.statsUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(changed, { merge: true });
});
