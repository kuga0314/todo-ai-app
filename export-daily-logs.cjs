#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function parseArgs() {
  const args = process.argv.slice(2);
  let userId = null;
  let outPath = path.resolve("daily_logs.csv");
  let loginOutPath = path.resolve("daily_logins.csv");

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--user") {
      if (i + 1 >= args.length) {
        throw new Error("--user requires a value");
      }
      userId = args[i + 1];
      i += 1;
    } else if (arg === "--out") {
      if (i + 1 >= args.length) {
        throw new Error("--out requires a value");
      }
      outPath = path.resolve(args[i + 1]);
      i += 1;
    } else if (arg === "--logins-out") {
      if (i + 1 >= args.length) {
        throw new Error("--logins-out requires a value");
      }
      loginOutPath = path.resolve(args[i + 1]);
      i += 1;
    }
  }

  return { userId, outPath, loginOutPath };
}

function loadServiceAccount() {
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const keyPath = envPath ? path.resolve(envPath) : path.resolve("serviceAccountKey.json");

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Service account key not found at ${keyPath}. Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in the project root.`,
    );
  }

  const fileContent = fs.readFileSync(keyPath, "utf8");
  return JSON.parse(fileContent);
}

function ensureFirebaseInitialized() {
  if (admin.apps.length === 0) {
    const serviceAccount = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

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

function formatDateToJst(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function formatDateTimeToJst(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const formatted = formatter.format(date);
  return formatted.replace(" ", "T");
}

function timestampToDateString(value) {
  const date = toDate(value);
  return date ? formatDateToJst(date) : "";
}

function parseUserIdFromPath(refPath) {
  // users/{uid}/logins/{docId}
  const segments = String(refPath).split("/");
  const userIndex = segments.indexOf("users");
  if (userIndex === -1 || userIndex + 1 >= segments.length) return null;
  return segments[userIndex + 1];
}

function normalizeLogDateKey(value) {
  if (!value) return "";
  const replaced = String(value).replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(replaced)) return replaced;

  const parsed = new Date(replaced);
  if (Number.isNaN(parsed.getTime())) return replaced;
  return formatDateToJst(parsed);
}

function csvEscape(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function fetchTodos(db, userId) {
  let query = db.collection("todos");
  if (userId) {
    query = query.where("userId", "==", userId);
  }
  const snapshot = await query.get();
  return snapshot.docs;
}

async function fetchLoginMap(db, userId) {
  const snapshot = await db.collectionGroup("logins").get();
  const byUser = new Map();

  for (const doc of snapshot.docs) {
    const uid = parseUserIdFromPath(doc.ref.path);
    if (!uid || (userId && uid !== userId)) continue;

    const data = doc.data() || {};
    const createdAt = toDate(data.createdAt) || toDate(doc.createTime) || null;
    const dateKey = formatDateToJst(createdAt);
    if (!dateKey) continue;

    if (!byUser.has(uid)) {
      byUser.set(uid, new Map());
    }

    const perDate = byUser.get(uid);
    const prev = perDate.get(dateKey);
    const firstLoginAt = prev?.firstLoginAt && createdAt && prev.firstLoginAt < createdAt ? prev.firstLoginAt : createdAt;

    perDate.set(dateKey, {
      loginFlag: 1,
      firstLoginAt,
    });
  }

  return byUser;
}

function getLoginInfo(loginMap, userId, dateKey) {
  const userMap = userId ? loginMap.get(userId) : null;
  if (!userMap) return { loginFlag: 0, firstLoginAtJst: "" };
  const info = userMap.get(dateKey);
  if (!info) return { loginFlag: 0, firstLoginAtJst: "" };
  return {
    loginFlag: info.loginFlag ?? 1,
    firstLoginAtJst: formatDateTimeToJst(info.firstLoginAt),
  };
}

function buildRows(todoId, data, loginMap) {
  const userId = data.userId ?? "";
  const estimatedMinutes = Number(data.estimatedMinutes);
  const estimatedMinutesValue = Number.isFinite(estimatedMinutes) ? estimatedMinutes : "";
  const deadlineDate = timestampToDateString(data.deadline ?? data.deadlineDate ?? null);
  const createdDate = timestampToDateString(data.createdAt ?? data.createdDate ?? null);
  const text = data.text ?? data.title ?? "";
  const logs = data.actualLogs && typeof data.actualLogs === "object" ? data.actualLogs : {};

  const rows = [];
  for (const [dateKey, minutes] of Object.entries(logs)) {
    const minutesNumber = Number(minutes);
    if (!Number.isFinite(minutesNumber) || minutesNumber < 0) continue;

    const normalizedDate = normalizeLogDateKey(dateKey);
    if (!normalizedDate) continue;

    const { loginFlag, firstLoginAtJst } = getLoginInfo(loginMap, userId, normalizedDate);

    rows.push([
      todoId,
      userId,
      normalizedDate,
      minutesNumber,
      estimatedMinutesValue,
      deadlineDate,
      createdDate,
      text,
      loginFlag,
      firstLoginAtJst,
    ]);
  }

  return rows;
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    const [aTodoId, , aDate] = a;
    const [bTodoId, , bDate] = b;
    if (aTodoId !== bTodoId) return String(aTodoId).localeCompare(String(bTodoId));
    return String(aDate).localeCompare(String(bDate));
  });
}

function writeCsv(rows, outPath, header) {
  const lines = [header, ...rows].map((columns) => columns.map(csvEscape).join(","));
  const csvContent = lines.join("\n");
  const bomCsv = `\uFEFF${csvContent}`;

  const dir = path.dirname(outPath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outPath, bomCsv, "utf8");
  return outPath;
}

function buildLoginRows(loginMap) {
  const rows = [];
  for (const [userId, perDate] of loginMap.entries()) {
    for (const [dateKey, info] of perDate.entries()) {
      rows.push([dateKey, userId, info.loginFlag ?? 1, formatDateTimeToJst(info.firstLoginAt)]);
    }
  }

  return rows.sort((a, b) => {
    const [aDate, aUser] = a;
    const [bDate, bUser] = b;
    if (aUser !== bUser) return String(aUser).localeCompare(String(bUser));
    return String(aDate).localeCompare(String(bDate));
  });
}

async function main() {
  const { userId, outPath, loginOutPath } = parseArgs();
  ensureFirebaseInitialized();
  const db = admin.firestore();

  const loginMap = await fetchLoginMap(db, userId);

  const todos = await fetchTodos(db, userId);
  const rows = [];

  for (const doc of todos) {
    const data = doc.data() || {};
    const todoRows = buildRows(doc.id, data, loginMap);
    rows.push(...todoRows);
  }

  const sortedRows = sortRows(rows);
  const header = [
    "todoId",
    "userId",
    "date",
    "minutes",
    "estimatedMinutes",
    "deadlineDate",
    "createdDate",
    "text",
    "loginFlag",
    "firstLoginAtJst",
  ];
  const outputPath = writeCsv(sortedRows, outPath, header);

  const loginRows = buildLoginRows(loginMap);
  const loginHeader = ["date", "userId", "loginFlag", "firstLoginAtJst"];
  const loginOutputPath = writeCsv(loginRows, loginOutPath, loginHeader);

  console.log(`Exported ${sortedRows.length} rows to ${outputPath}`);
  console.log(`Exported ${loginRows.length} login rows to ${loginOutputPath}`);
}

main().catch((error) => {
  console.error("Failed to export daily logs:", error);
  process.exit(1);
});
