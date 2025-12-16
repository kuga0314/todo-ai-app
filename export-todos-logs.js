// node export-todos-logs.js
// Export todos actualLogs into CSV files for research analysis.

import fs from "fs";
import path from "path";
import admin from "firebase-admin";

function loadServiceAccount() {
  // Keep serviceAccountKey.json out of git (.gitignore) because it contains secrets.
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

function csvEscape(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
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

function buildTodoRows(todoId, data) {
  const estimatedMinutes = data.estimatedMinutes ?? "";
  const deadline = toISOString(data.deadline);
  const completed = data.completed ? "true" : "false";
  const logs = data.actualLogs || {};

  const logRows = Object.entries(logs)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, minutes]) => {
      const parsedMinutes = Number(minutes);
      if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
        // Skip invalid or non-positive minute entries to avoid NaN/zero noise in analysis.
        return [];
      }

      const normalizedDate = normalizeDateKey(date);
      return [
        [todoId, normalizedDate, parsedMinutes],
      ];
    });

  const todoRow = [todoId, estimatedMinutes, deadline, completed];

  return { logRows, todoRow };
}

function sortLogRows(rows) {
  return rows.sort((a, b) => {
    const [aTodoId, aDate] = a;
    const [bTodoId, bDate] = b;
    if (aTodoId !== bTodoId) return aTodoId.localeCompare(bTodoId);
    return aDate.localeCompare(bDate);
  });
}

async function main() {
  const docs = await fetchTodos();
  const logRows = [];
  const todoRows = [];

  for (const todoDoc of docs) {
    const data = todoDoc.data() || {};
    if (data.deleted === true) continue;

    const todoId = todoDoc.id;
    const { logRows: todoLogs, todoRow } = buildTodoRows(todoId, data);

    logRows.push(...todoLogs);
    todoRows.push(todoRow);
  }

  const sortedLogs = sortLogRows(logRows);
  const sortedTodos = todoRows.sort((a, b) => a[0].localeCompare(b[0]));

  const exportDir = path.resolve("export");
  fs.mkdirSync(exportDir, { recursive: true });

  const logHeaders = ["todoId", "date", "actualMinutes"];
  const todoHeaders = ["todoId", "estimatedMinutes", "deadline", "completed"];

  const logCsvLines = [
    logHeaders.join(","),
    ...sortedLogs.map((row) => row.map(csvEscape).join(",")),
  ];

  const todoCsvLines = [
    todoHeaders.join(","),
    ...sortedTodos.map((row) => row.map(csvEscape).join(",")),
  ];

  const logsPath = path.join(exportDir, "logs_long.csv");
  const todosPath = path.join(exportDir, "todos.csv");

  fs.writeFileSync(logsPath, logCsvLines.join("\n"), "utf8");
  fs.writeFileSync(todosPath, todoCsvLines.join("\n"), "utf8");

  console.log(`Exported ${sortedLogs.length} log rows to ${logsPath}`);
  console.log(`Exported ${sortedTodos.length} todo rows to ${todosPath}`);
}

main().catch((err) => {
  console.error("Failed to export todos logs:", err);
  process.exit(1);
});
