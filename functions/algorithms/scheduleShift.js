// functions/algorithms/scheduleShift.js
/* eslint-env node */
/* eslint-disable no-undef */

const admin = require("firebase-admin");
const { modifiedPERT, deriveOMPW } = require("./pert");
const { clampToAllowedWindowNoDelay, dayAllowedWindowUtc, dayKeyJst } = require("./timeWindows");

const PRIORITY_FACTOR = { 3: 1.15, 2: 1.0, 1: 0.9 };

function kFromRiskMode(riskMode) {
  if (riskMode === "safe") return +1;
  if (riskMode === "challenge") return -1;
  return 0;
}

function computeRequiredMinutes(task, exp) {
  const kSigma = kFromRiskMode(exp?.riskMode || "mean");
  const bufferRate = Number.isFinite(task.buffer) ? task.buffer : 0;

  const E = Math.max(1, Number(task.estimatedMinutes ?? task.E ?? 0));
  const scale = task.scale ?? task.uncertainty ?? 3;

  const { O, M, P, w, sigma } = deriveOMPW(E, scale);
  const TEw = modifiedPERT(O, M, P, w);

  let core = TEw + kSigma * sigma;
  if (!isFinite(core) || core <= 0) core = Math.max(1, E);

  const pf = PRIORITY_FACTOR[Number(task.priority) || 2] ?? 1.0;
  const Treq = Math.max(1, Math.round(core * (1 + bufferRate) * pf));

  return { Treq, explain: { O, M, P, w, sigma, TEw, kSigma, bufferRate, pf } };
}

function allocateBackward(deadline, minutesNeeded, userSettings, occupiedByDay, capacityUsed) {
  let remain = minutesNeeded;
  let cursor = new Date(deadline);
  const blocks = [];

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
        const take = Math.min(availableMin, remain, capRemain - todayTaken);
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

    if (remain > 0) cursor = new Date(startUtc.getTime() - 1);
  }

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, usedMinutes: minutesNeeded - remain };
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

function scheduleShift(tasks, userSettings, experimentSettings) {
  if (!Array.isArray(tasks)) return [];

  const exp = {
    algoVariant: experimentSettings?.algoVariant || "modifiedPERT",
    riskMode: experimentSettings?.riskMode || "mean",
  };

  const withT = tasks.map((t) => {
    const { Treq, explain } = computeRequiredMinutes(t, exp);
    return { ...t, T_req_min: Treq, _explainCore: explain };
  });

  // ★ 修正: 締切同じ場合は「優先度高い順」に右側から確保する
  withT.sort((a, b) => {
    const da = new Date(a.deadlineIso), db = new Date(b.deadlineIso);
    if (da - db !== 0) return da - db;
    const pa = Number(a.priority) || 2, pb = Number(b.priority) || 2;
    if (pb - pa !== 0) return pb - pa; // 高優先度を先に
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });

  const occupiedByDay = new Map();
  const capacityUsed = new Map();

  const results = withT.map((t) => {
    const deadline = new Date(t.deadlineIso);
    const { blocks } = allocateBackward(deadline, t.T_req_min, userSettings, occupiedByDay, capacityUsed);

    const latestStartIso = blocksToLatestStartIso(blocks);
    const startRecommendIso = blocksToStartRecommendIso(blocks, userSettings);

    const startRecommendTs = startRecommendIso ? admin.firestore.Timestamp.fromDate(new Date(startRecommendIso)) : null;
    const latestStartTs = latestStartIso ? admin.firestore.Timestamp.fromDate(new Date(latestStartIso)) : null;

    return {
      ...t,
      latestStartIso,
      latestStart: latestStartTs,
      startRecommendIso,
      startRecommend: startRecommendTs,
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
