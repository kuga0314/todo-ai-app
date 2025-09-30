// functions/algorithms/scheduleShift.js
/* eslint-env node */
/* eslint-disable no-undef */

const admin = require("firebase-admin");
const { modifiedPERT, deriveOMPW } = require("./pert");
const {
  clampToAllowedWindowNoDelay,
  dayAllowedWindowUtc,
  dayKeyJst,
  dayKeyIso,
} = require("./timeWindows");

// 重要度による係数（通知計算には影響しないが T_req 調整用に残す）
const IMPORTANCE_FACTOR = { 3: 1.15, 2: 1.0, 1: 0.9 };

function kFromRiskMode(riskMode) {
  if (riskMode === "safe") return +1;       // 平均＋σ
  if (riskMode === "challenge") return -1;  // 平均−σ
  return 0;                                 // 平均
}

/**
 * 所要分を計算：
 * 1) E から deriveOMPW で初期 O/M/P/w を生成（w が未入力ならフォールバック）
 * 2) タスクに O/P/w が入っていればその値で上書き
 * 3) σ と TEw を再計算して T_req を返す
 */
function computeRequiredMinutes(task, exp) {
  const kSigma = kFromRiskMode(exp?.riskMode || "mean");
  const bufferRate = Number.isFinite(task.buffer) ? task.buffer : 0;

  const E = Math.max(1, Number(task.estimatedMinutes ?? task.E ?? 0));

  // 1) 初期値生成（w を優先、無ければ3）
  let { O, M, P, w, sigma } = deriveOMPW(E, task.w ?? task.pertWeight ?? task.scale ?? 3);

  // 2) 任意入力があれば上書き
  const Oin = Number(task.O);
  const Pin = Number(task.P);
  const win = Number(task.w ?? task.pertWeight);
  if (Number.isFinite(Oin) && Oin > 0) O = Math.round(Oin);
  if (Number.isFinite(Pin) && Pin > 0) P = Math.round(Pin);
  if (Number.isFinite(win) && win > 0) w = Math.round(win);

  // 3) 妥当化 & 再計算
  if (!(P > O)) P = Math.max(O + 1, P || (O + 1));
  if (M <= 0) M = Math.max(1, Math.round(E));

  sigma = (P - O) / 6;
  const TEw = modifiedPERT(O, M, P, w);

  let core = TEw + kSigma * sigma;
  if (!isFinite(core) || core <= 0) core = Math.max(1, E);

  const imp = Number(task.importance ?? task.priority) || 2;
  const pf = IMPORTANCE_FACTOR[imp] ?? 1.0;
  const Treq = Math.max(1, Math.round(core * (1 + bufferRate) * pf));

  return { Treq, explain: { O, M, P, w, sigma, TEw, kSigma, bufferRate, pf } };
}

/** 期限から逆算してブロックを配置（許可ウィンドウ・キャパ・衝突回避） */
function allocateBackward(deadline, minutesNeeded, userSettings, occupiedByDay, capacityUsed, options = {}) {
  let remain = minutesNeeded;
  let cursor = new Date(deadline);
  const blocks = [];
  const perDayLimit = Number.isFinite(options?.dailyLimit) && options.dailyLimit > 0
    ? Math.max(1, Math.round(options.dailyLimit))
    : null;
  const maxLookbackDays = Number.isFinite(options?.maxLookbackDays)
    ? Math.max(1, Math.round(options.maxLookbackDays))
    : 180;
  let lookedDays = 0;

  while (remain > 0) {
    const { startUtc, endUtc, empty } = dayAllowedWindowUtc(
      cursor,
      userSettings?.notifyWindow,
      userSettings?.workHours
    );
    if (empty) {
      cursor = new Date(startUtc.getTime() - 1);
      continue;
    }

    const dk = dayKeyJst(cursor);
    const occ = occupiedByDay.get(dk) || [];

    const dow = startUtc.getUTCDay();
    const capForDay = userSettings?.dailyCapacityByDOW?.[dow];
    const used = capacityUsed.get(dk) || 0;
    const capRemain = (capForDay == null) ? Infinity : Math.max(0, capForDay - used);
    if (capRemain <= 0) {
      cursor = new Date(startUtc.getTime() - 1);
      continue;
    }

    const todayRight = cursor < endUtc ? cursor : endUtc;

    const forbids = occ
      .filter(b => !(b.end <= startUtc || b.start >= endUtc))
      .map(b => ({
        start: new Date(Math.max(b.start.getTime(), startUtc.getTime())),
        end: new Date(Math.min(b.end.getTime(), endUtc.getTime())),
      }))
      .sort((a, b) => b.end - a.end);

    let segRight = todayRight;
    let todayTaken = 0;

    while (segRight > startUtc && remain > 0 && todayTaken < capRemain) {
      const forbid = forbids.find(f => f.start < segRight && f.end > startUtc && f.end <= segRight);
      const segLeft = forbid ? new Date(Math.max(startUtc.getTime(), forbid.end.getTime())) : startUtc;
      const availableMin = Math.max(0, Math.floor((segRight - segLeft) / 60000));

      if (availableMin > 0) {
        const limitRemain = perDayLimit != null ? Math.max(0, perDayLimit - todayTaken) : Infinity;
        if (limitRemain <= 0) break;
        const take = Math.min(availableMin, remain, capRemain - todayTaken, limitRemain);
        if (take > 0) {
          const blockStart = new Date(segRight.getTime() - take * 60000);
          const blockEnd = segRight;
          blocks.push({ start: blockStart, end: blockEnd });
          remain -= take;
          todayTaken += take;
          segRight = blockStart;
        }
      }
      if (forbid) {
        segRight = forbid.start;
      } else {
        break;
      }
    }

    if (todayTaken > 0) {
      capacityUsed.set(dk, (capacityUsed.get(dk) || 0) + todayTaken);
      const dayOcc = occupiedByDay.get(dk) || [];
      const todayBlocks = blocks.filter(b => b.end <= todayRight && b.start >= startUtc);
      dayOcc.push(...todayBlocks);
      occupiedByDay.set(dk, dayOcc);
    }

    lookedDays += 1;
    if (remain > 0) {
      cursor = new Date(startUtc.getTime() - 1);
      if (lookedDays > maxLookbackDays) break;
    }
  }

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, usedMinutes: minutesNeeded - remain, remaining: remain };
}

function blocksToStartRecommendIso(blocks, userSettings) {
  if (!blocks?.length) return null;
  const iso = blocks[0].start.toISOString();
  const clamped = clampToAllowedWindowNoDelay(new Date(iso), userSettings?.notifyWindow, userSettings?.workHours);
  return clamped?.toISOString?.() || iso;
}
function blocksToLatestStartIso(blocks) {
  if (!blocks?.length) return null;
  return blocks[0].start.toISOString();
}

function blocksToDailyAssignments(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const buckets = new Map();
  for (const block of blocks) {
    const minutes = Math.max(0, Math.round((block.end - block.start) / 60000));
    if (minutes <= 0) continue;
    const key = dayKeyIso(block.start);
    buckets.set(key, (buckets.get(key) || 0) + minutes);
  }
  return [...buckets.entries()]
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * メイン：タスク群へ T_req を付与 → 期限昇順、
 * 同一期限は重要度（高→低）→作成時刻で安定ソート → ブロック敷設
 */
function scheduleShift(tasks, userSettings, experimentSettings) {
  if (!Array.isArray(tasks)) return [];

  const exp = {
    algoVariant: experimentSettings?.algoVariant || "modifiedPERT",
    riskMode: experimentSettings?.riskMode || "mean",
  };

  const withT = tasks.map((t) => {
    const { Treq, explain } = computeRequiredMinutes(t, exp);
    const dailyLimit = Number.isFinite(t.dailyMinutes) && t.dailyMinutes > 0
      ? Math.round(t.dailyMinutes)
      : (Number.isFinite(userSettings?.defaults?.todoDailyMinutes)
        && userSettings.defaults.todoDailyMinutes > 0
        ? Math.round(userSettings.defaults.todoDailyMinutes)
        : null);
    return { ...t, T_req_min: Treq, _explainCore: explain, _dailyLimit: dailyLimit };
  });

  withT.sort((a, b) => {
    const da = new Date(a.deadlineIso), db = new Date(b.deadlineIso);
    if (da - db !== 0) return da - db;
    const ia = Number(a.importance ?? a.priority) || 2;
    const ib = Number(b.importance ?? b.priority) || 2;
    if (ib - ia !== 0) return ib - ia;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });

  const occupiedByDay = new Map();
  const capacityUsed = new Map();

  const results = withT.map((t) => {
    const deadline = new Date(t.deadlineIso);
    const { blocks, remaining } = allocateBackward(
      deadline,
      t.T_req_min,
      userSettings,
      occupiedByDay,
      capacityUsed,
      { dailyLimit: t._dailyLimit }
    );

    const latestStartIso = blocksToLatestStartIso(blocks);
    const startRecommendIso = blocksToStartRecommendIso(blocks, userSettings);
    const dailyAssignments = blocksToDailyAssignments(blocks);
    const assignedMinutes = dailyAssignments.reduce((sum, row) => sum + row.minutes, 0);

    const startRecommendTs = startRecommendIso ? admin.firestore.Timestamp.fromDate(new Date(startRecommendIso)) : null;
    const latestStartTs = latestStartIso ? admin.firestore.Timestamp.fromDate(new Date(latestStartIso)) : null;

    return {
      ...t,
      latestStartIso,
      latestStart: latestStartTs,
      startRecommendIso,
      startRecommend: startRecommendTs,
      assignedMinutes,
      unallocatedMinutes: Math.max(0, Math.round(remaining || 0)),
      dailyAssignments,
      explain: {
        ...(t.explain || {}),
        variant: exp.algoVariant,
        riskMode: exp.riskMode,
        ...t._explainCore,
      },
    };
  });

  return results;
}

module.exports = { scheduleShift, computeRequiredMinutes };
