// scripts/export_analysis3_csv.js
// Export analysis-3 datasets (daily plan and actuals) from Firestore to CSV.

import fs from "fs";
import path from "path";
import admin from "firebase-admin";

function loadServiceAccount() {
  const credentialsPath = path.resolve("serviceAccountKey.json");
  const raw = fs.readFileSync(credentialsPath, "utf8");
  return JSON.parse(raw);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

const db = admin.firestore();

const TZ = "Asia/Tokyo";

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--start" || arg === "--startDate") {
      result.startDate = args[i + 1];
      i += 1;
    } else if (arg === "--end" || arg === "--endDate") {
      result.endDate = args[i + 1];
      i += 1;
    }
  }

  if (!result.startDate || !result.endDate) {
    throw new Error("Usage: node scripts/export_analysis3_csv.js --start YYYY-MM-DD --end YYYY-MM-DD");
  }

  return result;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    const milliseconds = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
    return new Date(milliseconds);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(value) {
  const d = toDate(value);
  return d ? d.toISOString() : "";
}

function dateKeyJst(date) {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(date);
}

function buildDateRange(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00+09:00`);
  const end = new Date(`${endKey}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range");
  }

  const keys = [];
  for (let dt = new Date(start); dt.getTime() <= end.getTime(); dt.setDate(dt.getDate() + 1)) {
    keys.push(dateKeyJst(new Date(dt)));
  }
  return keys;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function ensureExportsDir() {
  fs.mkdirSync("exports", { recursive: true });
}

function pickSpi(todo) {
  if (todo == null) return "";
  const spiAdj = todo.spiAdj ?? null; // optional override
  const spi = spiAdj ?? todo.spi7d ?? todo.spi;
  return spi == null ? "" : spi;
}

function pickEacDate(todo) {
  if (!todo) return "";
  return todo.eacDate || "";
}

function pickDeadline(todo) {
  if (!todo?.deadline) return "";
  const iso = formatIsoDate(todo.deadline);
  return iso ? iso : "";
}

function pickStatsUpdatedAt(todo) {
  if (!todo?.statsUpdatedAt) return "";
  return formatIsoDate(todo.statsUpdatedAt);
}

function pickPlanUpdatedAt(planDoc, planData) {
  if (planDoc?.updateTime) {
    const iso = formatIsoDate(planDoc.updateTime);
    if (iso) return iso;
  }
  if (!planData?.updatedAt) return "";
  return formatIsoDate(planData.updatedAt);
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

async function fetchTodosMap() {
  const snap = await db.collection("todos").get();
  const map = new Map();
  for (const doc of snap.docs) {
    map.set(doc.id, doc.data() || {});
  }
  return map;
}

function extractPlanMeta(planDoc) {
  const data = planDoc.data() || {};
  const userId = data.userId || planDoc.ref.parent?.parent?.id || "";
  const dateKey = data.date || planDoc.id;
  return { data, userId, dateKey };
}

function dateOnly(value) {
  const d = toDate(value);
  return d ? dateKeyJst(d) : "";
}

function buildPlanRows(planDoc, todosMap, dateSet, plannedTodoIds) {
  const { data, userId, dateKey } = extractPlanMeta(planDoc);
  if (!dateSet.has(dateKey)) return [];

  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return [];

  const rows = [];
  for (const item of items) {
    const todoId = item?.todoId || "";
    const todo = todoId ? todosMap.get(todoId) : null;
    const spi = pickSpi(todo);
    const eacDate = pickEacDate(todo);
    const riskLevel = todo?.riskLevel ?? "";
    const idealProgress = normalizeNumber(todo?.idealProgress);
    const actualProgress = normalizeNumber(todo?.actualProgress);
    const deadline = pickDeadline(todo);
    const statsUpdatedAt = pickStatsUpdatedAt(todo);
    const deadlineDate = deadline ? dateOnly(todo?.deadline) : "";
    const statsUpdatedDate = statsUpdatedAt ? dateOnly(todo?.statsUpdatedAt) : "";
    const planUpdatedAt = pickPlanUpdatedAt(planDoc, data);

    if (todoId) {
      plannedTodoIds.add(todoId);
    }

    const row = [
      userId,
      dateKey,
      todoId,
      normalizeNumber(item?.plannedMinutes ?? item?.todayMinutes),
      normalizeNumber(data.capMinutes),
      normalizeNumber(data.totalPlannedMinutes),
      spi,
      eacDate,
      riskLevel || "",
      idealProgress,
      actualProgress,
      deadline,
      deadlineDate,
      statsUpdatedAt,
      statsUpdatedDate,
      planUpdatedAt,
    ].map(csvEscape).join(",");

    rows.push(row);
  }

  return rows;
}

function buildActualRows(todosMap, dateSet, plannedTodoIds) {
  const rows = [];
  for (const todoId of plannedTodoIds) {
    const todo = todosMap.get(todoId);
    if (!todo) continue;
    const userId = todo?.userId || "";
    const actualLogs = todo?.actualLogs || {};
    for (const [dateKey, value] of Object.entries(actualLogs)) {
      if (!dateSet.has(dateKey)) continue;
      const minutes = normalizeNumber(value);
      const row = [
        userId,
        dateKey,
        todoId,
        minutes,
      ].map(csvEscape).join(",");
      rows.push(row);
    }
  }
  return rows;
}

async function main() {
  const { startDate, endDate } = parseArgs();
  ensureExportsDir();

  const dateKeys = buildDateRange(startDate, endDate);
  const dateSet = new Set(dateKeys);

  const todosMap = await fetchTodosMap();

  const planRows = [];
  const plannedTodoIds = new Set();
  const usersSnap = await db.collection("users").get();
  const FieldPath = admin.firestore.FieldPath;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const plansSnap = await db
      .collection("users")
      .doc(uid)
      .collection("dailyPlans")
      .orderBy(FieldPath.documentId())
      .startAt(startDate)
      .endAt(endDate)
      .get();

    for (const planDoc of plansSnap.docs) {
      planRows.push(...buildPlanRows(planDoc, todosMap, dateSet, plannedTodoIds));
    }
  }

  const actualRows = buildActualRows(todosMap, dateSet, plannedTodoIds);

  const planHeader = [
    "userId",
    "date",
    "todoId",
    "plannedMinutes",
    "capMinutes",
    "totalPlannedMinutes",
    "spi",
    "eacDate",
    "riskLevel",
    "idealProgress",
    "actualProgress",
    "deadline",
    "deadlineDate",
    "statsUpdatedAt",
    "statsUpdatedDate",
    "planUpdatedAt",
  ].join(",");

  const actualHeader = [
    "userId",
    "date",
    "todoId",
    "actualMinutes",
  ].join(",");

  const planCsv = [planHeader, ...planRows].join("\n");
  const actualCsv = [actualHeader, ...actualRows].join("\n");

  fs.writeFileSync(path.join("exports", "analysis3_daily_plan.csv"), planCsv, "utf8");
  fs.writeFileSync(path.join("exports", "analysis3_daily_actual.csv"), actualCsv, "utf8");

  console.log(`analysis3_daily_plan.csv rows: ${planRows.length}`);
  console.log(`analysis3_daily_actual.csv rows: ${actualRows.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
