// functions/scheduleShift.js
/* eslint-env node */
/* eslint-disable no-undef */

/**
 * 互換スタブ。
 * 以前は PERT / 重要度 を使って日次割当を行っていたが廃止。
 * 現在は呼ばれても何もせず、引数をそのまま返すだけ。
 */

function scheduleShift({ tasks = [], capacity = null } = {}) {
  return {
    ok: true,
    assigned: [],
    unassigned: tasks.map(t => t?.id).filter(Boolean),
    note: "legacy scheduleShift removed",
    capacity
  };
}

module.exports = { scheduleShift };
