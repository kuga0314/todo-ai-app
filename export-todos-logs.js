// node export-todos-logs.js
// Export todos actualLogs into CSV files for research analysis.
// Added SPI×ΔEAC metrics columns for logs_long.csv and todos.csv snapshots.
// Header examples:
// logs_long.csv => todoId,date,actualMinutes,pace7,spi,remaining,daysLeft,required
// todos.csv     => todoId,estimatedMinutes,deadline,completed,pace7_latest,spi_latest,remaining_latest,daysLeft_latest,required_latest

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

  const parsedDeadline = toDate(data.deadline);
  const estimatedMinutesNumber = Number(estimatedMinutes) || 0;

  const normalizedLogEntries = Object.entries(logs)
    .map(([date, minutes]) => [normalizeDateKey(date), Number(minutes)])
    .filter(([, minutes]) => Number.isFinite(minutes) && minutes > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const logsByDate = new Map(normalizedLogEntries);

  function formatDateKey(date) {
    const d = new Date(date.getTime());
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getLast7DayStats(dateKey) {
    const referenceDate = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(referenceDate.getTime())) return { pace7: null };

    let sum = 0;
    let daysWorked = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(referenceDate.getTime());
      d.setUTCDate(referenceDate.getUTCDate() - i);
      const key = formatDateKey(d);
      const value = Number(logsByDate.get(key)) || 0;
      sum += value;
      if (value > 0) daysWorked += 1;
    }

    const denominator = Math.max(1, daysWorked < 3 ? daysWorked || 1 : 7);
    return { pace7: sum / denominator };
  }

  const logRows = [];
  let cumulative = 0;
  let latestMetrics = {
    pace7: data.pace7 ?? data.pace7d ?? null,
    spi: data.spi ?? null,
    remaining: data.remaining ?? data.remainingMinutes ?? null,
    daysLeft: data.daysLeft ?? null,
    required: data.required ?? data.requiredPace ?? null,
  };

  for (const [date, minutes] of normalizedLogEntries) {
    cumulative += minutes;
    const remaining = Math.max(0, estimatedMinutesNumber - cumulative);

    let daysLeft = null;
    if (parsedDeadline instanceof Date && !Number.isNaN(parsedDeadline.getTime())) {
      const logDate = new Date(`${date}T00:00:00Z`);
      const diffMs = parsedDeadline.getTime() - logDate.getTime();
      const rawDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      daysLeft = Math.max(1, rawDays);
    }

    const { pace7 } = getLast7DayStats(date);
    const required = daysLeft && daysLeft > 0 ? remaining / daysLeft : null;
    let spi = null;
    if (required && required > 0) {
      const raw = pace7 / required;
      spi = Number.isFinite(raw) ? raw : null;
    } else if (remaining === 0) {
      spi = 1;
    }

    latestMetrics = {
      pace7: latestMetrics.pace7 ?? pace7,
      spi: latestMetrics.spi ?? spi,
      remaining: remaining ?? latestMetrics.remaining,
      daysLeft: daysLeft ?? latestMetrics.daysLeft,
      required: latestMetrics.required ?? required,
    };

    logRows.push([
      todoId,
      date,
      minutes,
      pace7 ?? "",
      spi ?? "",
      remaining ?? "",
      daysLeft ?? "",
      required ?? "",
    ]);
  }

  const todoRow = [
    todoId,
    estimatedMinutes,
    deadline,
    completed,
    latestMetrics.pace7 ?? data.pace7d ?? data.pace7 ?? "",
    latestMetrics.spi ?? data.spi ?? "",
    latestMetrics.remaining ?? "",
    latestMetrics.daysLeft ?? "",
    latestMetrics.required ?? data.requiredPace ?? data.required ?? "",
  ];

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

  const logHeaders = [
    "todoId",
    "date",
    "actualMinutes",
    "pace7",
    "spi",
    "remaining",
    "daysLeft",
    "required",
  ];
  const todoHeaders = [
    "todoId",
    "estimatedMinutes",
    "deadline",
    "completed",
    "pace7_latest",
    "spi_latest",
    "remaining_latest",
    "daysLeft_latest",
    "required_latest",
  ];

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
