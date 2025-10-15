/* eslint-env node */
/* global Intl */
const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

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
function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const ts = Date.parse(value);
    if (!Number.isNaN(ts)) return new Date(ts);
  }
  return null;
}
const EPS = 1e-6;
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * todos/{id} 書き込み時に進捗統計を更新
 * 既存: pace7d / requiredPace / spi / eacDate / riskLevel
 * 追加: paceExp / spiExp / requiredPaceAdj / spiAdj（モデル拡張）
 * - paceExp: 指数平滑ペース（alphaはユーザー設定があれば使用、既定0.3）
 * - 動的バッファ: spi7d(=spi)が閾値未満なら必要ペースを緩和（既定0.9倍）
 */
exports.onTodoStats = onDocumentWritten("todos/{id}", async (event) => {
  const afterSnap = event.data?.after;
  if (!afterSnap?.exists) return; // 削除は無視
  const after = afterSnap.data();
  const ref = afterSnap.ref;

  // 入力（E と 実績ログ）
  const E = Number(after.estimatedMinutes) || 0;
  const logs = after.actualLogs || {}; // { "YYYY-MM-DD": minutes }
  const userId = after.userId;

  // ユーザー設定（なければ既定値）
  let alpha = 0.3;             // 指数平滑の係数 (0..1)
  let spiWarnThreshold = 0.9;  // warn判定に使う参考閾値（今回は既存riskには未適用）
  let relaxFactor = 0.9;       // 動的バッファの緩和倍率（必要ペースに掛ける）
  try {
    if (userId) {
      const appSnap = await admin.firestore().doc(`users/${userId}/settings/app`).get();
      if (appSnap.exists) {
        const s = appSnap.data() || {};
        if (Number.isFinite(Number(s.alpha))) alpha = Math.max(0, Math.min(1, Number(s.alpha)));
        if (Number.isFinite(Number(s.spiWarnThreshold))) spiWarnThreshold = Number(s.spiWarnThreshold);
        if (Number.isFinite(Number(s.relaxFactor))) relaxFactor = Number(s.relaxFactor);
      }
    }
  } catch (e) {
    console.warn("read settings/app failed; using defaults", e);
  }

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

  // 指数平滑ペース（当日ログから単純更新）
  const todayKey = jstDateKey(today);
  const todayLog = Number(logs[todayKey]) || 0;
  const prevPaceExp = Number(after.paceExp) || 0; // 既存フィールドがなければ0
  const paceExp = alpha * todayLog + (1 - alpha) * prevPaceExp;

  // 残量
  const R = Math.max(0, E - A);

  // 残日数・必要ペース・EAC日
  let requiredPace = 0;
  let eacDate = null;
  let deadline = null;
  let totalDays = null;
  let elapsedDays = null;

  if (after.deadline) {
    deadline =
      after.deadline.toDate?.() ??
      (after.deadline.seconds
        ? new Date(after.deadline.seconds * 1000)
        : new Date(after.deadline));
  }
  const createdAt = toJsDate(after.createdAt);

  if (deadline) {
    const ms = deadline.getTime() - today.getTime();
    const D = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24))); // 最低1日
    requiredPace = R > 0 ? R / D : 0;

    const denom = Math.max(EPS, pace7d);
    const daysToFinish = R > 0 ? Math.ceil(R / denom) : 0;
    eacDate = jstDateKey(addDays(today, daysToFinish));

    if (createdAt) {
      const totalMs = deadline.getTime() - createdAt.getTime();
      const elapsedMs = today.getTime() - createdAt.getTime();
      totalDays = Math.max(1, Math.ceil(totalMs / (1000 * 60 * 60 * 24)));
      elapsedDays = Math.max(0, Math.ceil(elapsedMs / (1000 * 60 * 60 * 24)));
    }
  }

  // SPI（従来互換：pace7d / requiredPace を spi として維持）
  const spi7d = requiredPace > EPS ? pace7d / requiredPace : (R === 0 ? 1 : 0);
  const spiExp = requiredPace > EPS ? paceExp / requiredPace : (R === 0 ? 1 : 0);

  // 動的バッファ（簡易版）
  // spi7d（=従来のspi相当）が閾値未満なら、必要ペースを緩和して再評価
  const relax = spi7d < spiWarnThreshold ? relaxFactor : 1.0;
  const requiredPaceAdj = requiredPace * relax;
  const spiAdj = requiredPaceAdj > EPS ? pace7d / requiredPaceAdj : (R === 0 ? 1 : 0);

  let idealProgress = null;
  if (totalDays != null && Number.isFinite(totalDays) && totalDays > 0) {
    const ratio = elapsedDays != null ? elapsedDays / totalDays : null;
    if (ratio != null && Number.isFinite(ratio)) {
      idealProgress = Math.max(0, Math.min(1, ratio));
    }
  }

  let actualProgress = null;
  if (E > 0) {
    const ratio = A / E;
    if (Number.isFinite(ratio)) {
      actualProgress = Math.max(0, Math.min(1, ratio));
    }
  }

  const idealProgressRounded =
    idealProgress != null ? round2(idealProgress) : null;
  const actualProgressRounded =
    actualProgress != null ? round2(actualProgress) : null;

  // 既存の riskLevel ロジック（互換維持）
  const spi = spi7d; // 既存フィールド名に合わせて採用
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
    pace7d: round1(pace7d),
    paceExp: round1(paceExp),
    requiredPace: round1(requiredPace),
    requiredPaceAdj: round1(requiredPaceAdj),
    spi: round2(spi),          // 従来互換（= spi7d）
    spi7d: round2(spi7d),      // 明示的に保存
    spiExp: round2(spiExp),
    spiAdj: round2(spiAdj),
    eacDate: eacDate,          // "YYYY-MM-DD" or null
    riskLevel,                 // "ok" | "warn" | "late"
    idealProgress: idealProgressRounded,
    actualProgress: actualProgressRounded,
  };

  if (userId) {
    try {
      const metricsRef = db.doc(`users/${userId}/metrics/${todayKey}`);
      await metricsRef.set(
        {
          evm: {
            spi: next.spi,
            eacDate: next.eacDate,
            riskLevel: next.riskLevel,
            idealProgress: idealProgressRounded,
            actualProgress: actualProgressRounded,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (logErr) {
      console.error("failed to update daily EVM metrics", {
        userId,
        date: todayKey,
        error: logErr,
      });
    }
  }

  // 既存値（差分更新して再発火ループを防ぐ）
  const prev = {
    actualTotalMinutes: Number(after.actualTotalMinutes) || 0,
    pace7d: Number(after.pace7d) || 0,
    paceExp: Number(after.paceExp) || 0,
    requiredPace: Number(after.requiredPace) || 0,
    requiredPaceAdj: Number(after.requiredPaceAdj) || 0,
    spi: Number(after.spi),
    spi7d: Number(after.spi7d),
    spiExp: Number(after.spiExp),
    spiAdj: Number(after.spiAdj),
    eacDate: after.eacDate ?? null,
    riskLevel: after.riskLevel ?? null,
    idealProgress: Number.isFinite(Number(after.idealProgress))
      ? Number(after.idealProgress)
      : after.idealProgress ?? null,
    actualProgress: Number.isFinite(Number(after.actualProgress))
      ? Number(after.actualProgress)
      : after.actualProgress ?? null,
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
