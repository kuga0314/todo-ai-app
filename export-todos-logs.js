// node export-todos-logs.js
// Export todos actualLogs into a CSV file for research analysis.

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

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    const milliseconds = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
    return new Date(milliseconds);
  }
  return null;
}

function toISOString(value) {
  const date = toDate(value);
  return date ? date.toISOString() : "";
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function csvEscape(value) {
  const stringValue = normalizeValue(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatFilename(date = new Date()) {
  const pad = (num) => String(num).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `todos_logs_export_${year}${month}${day}_${hours}${minutes}${seconds}.csv`;
}

async function fetchTodos() {
  const snapshot = await db.collection("todos").get();
  return snapshot.docs;
}

function normalizeDateKey(dateKey) {
  if (!dateKey) return "";
  const stringValue = String(dateKey);
  const withHyphens = stringValue.includes("/")
    ? stringValue.replace(/\//g, "-")
    : stringValue;

  const parsed = new Date(withHyphens);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(withHyphens)) {
    return withHyphens;
  }

  return stringValue;
}

function buildTodoRows(todoId, data, userId) {
  const taskName = data.text || "";
  const estimatedMinutes = data.estimatedMinutes ?? "";
  const deadline = toISOString(data.deadline);
  const completed = data.completed ? "true" : "false";
  const logs = data.actualLogs || {};

  const rows = Object.entries(logs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => {
      const normalizedDate = normalizeDateKey(date);
      return [
        userId,
        todoId,
        taskName,
        normalizedDate,
        normalizeValue(minutes),
        normalizeValue(estimatedMinutes),
        deadline,
        completed,
      ];
    });

  return rows;
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    const aUserId = a[0];
    const bUserId = b[0];
    if (aUserId !== bUserId) return aUserId.localeCompare(bUserId);

    const aTodo = a[1];
    const bTodo = b[1];
    if (aTodo !== bTodo) return aTodo.localeCompare(bTodo);

    const aDate = a[3];
    const bDate = b[3];
    return aDate.localeCompare(bDate);
  });
}

async function main() {
  const docs = await fetchTodos();
  const rows = [];

  for (const todoDoc of docs) {
    const data = todoDoc.data() || {};
    if (data.deleted === true) continue;

    const userId = data.userId || data.uid || "";
    const todoId = todoDoc.id;

    rows.push(...buildTodoRows(todoId, data, userId));
  }

  const sorted = sortRows(rows);
  const headers = [
    "userId",
    "todoId",
    "taskName",
    "date",
    "actualMinutes",
    "estimatedMinutes",
    "deadline",
    "completed",
  ];

  const csvLines = [
    headers.join(","),
    ...sorted.map((row) => row.map(csvEscape).join(",")),
  ];

  const filename = formatFilename();
  const outputPath = path.resolve(filename);
  fs.writeFileSync(outputPath, csvLines.join("\n"), "utf8");

  console.log(`Exported ${sorted.length} rows to ${filename}`);
}

main().catch((err) => {
  console.error("Failed to export todos logs:", err);
  process.exit(1);
});
