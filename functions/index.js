/* eslint-env node */
const admin = require("firebase-admin");
admin.initializeApp();

// 第一弾：日次進捗リマインドのみ有効化
exports.scheduleProgressReminder =
  require("./scheduleProgressReminder").scheduleProgressReminder;

exports.onTodoStats = require("./updateStats").onTodoStats;

exports.scheduleMorningSummary   = require("./scheduleMorningSummary").scheduleMorningSummary;