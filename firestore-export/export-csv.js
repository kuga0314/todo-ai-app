//エクスポートする際はnode export-csv.js --all --out ./export

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

try {
  require("dotenv").config({ path: __dirname + "/.env" });
} catch (err) {
  if (err?.code !== "MODULE_NOT_FOUND") throw err;
}

function loadServiceAccount() {
  const jsonInline = process.env.FIREBASE_ADMIN_KEY_JSON;
  if (jsonInline) {
    return JSON.parse(jsonInline);
  }
  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gacPath) {
    const raw = fs.readFileSync(gacPath, "utf8");
    return JSON.parse(raw);
  }
  throw new Error(
    "Service Account credentials not found. Set FIREBASE_ADMIN_KEY_JSON or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}
const db = admin.firestore();

const labelCache = new Map();

function toDate(value) {
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

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => escapeCsv(row[key])).join(","));
  }
  return `\ufeff${lines.join("\n")}`;
}

function numOrBlank(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function toIso(value) {
  return toDate(value)?.toISOString() || "";
}

function toEacDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return toIso(value);
}

async function loadLabelsForUser(userId) {
  if (!userId) return new Map();
  if (labelCache.has(userId)) return labelCache.get(userId);

  const map = new Map();
  try {
    const snap = await db.collection("users").doc(userId).collection("labels").get();
    snap.forEach((docSnap) => {
      const label = docSnap.data() || {};
      map.set(docSnap.id, {
        name: label.name || label.labelName || "",
        color: label.color || label.labelColor || "",
      });
    });
  } catch (err) {
    console.warn(`⚠️ failed to load labels for user ${userId}`, err?.message || err);
  }

  labelCache.set(userId, map);
  return map;
}

function getLabelMeta(userId, labelId) {
  if (!userId || !labelId) return { name: "", color: "" };
  const map = labelCache.get(userId);
  if (!map) return { name: "", color: "" };
  const meta = map.get(labelId);
  if (!meta) return { name: "", color: "" };
  return meta;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outDir: process.cwd(),
    user: null,
    from: null,
    to: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out" && args[i + 1]) {
      options.outDir = path.resolve(args[i + 1]);
      i += 1;
    } else if (arg === "--user" && args[i + 1]) {
      options.user = args[i + 1];
      i += 1;
    } else if (arg === "--all") {
      options.user = null;
    } else if (arg === "--from" && args[i + 1]) {
      options.from = args[i + 1];
      i += 1;
    } else if (arg === "--to" && args[i + 1]) {
      options.to = args[i + 1];
      i += 1;
    }
  }

  return options;
}

function isWithinRange(dateKey, from, to) {
  if (!dateKey) return false;
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

async function main() {
  const options = parseArgs();
  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  console.log("=== Firestore Export Start ===");

  const todosSnap = await db.collection("todos").get();
  const taskRows = [];
  const dailyRows = [];
  const todos = [];
  const labelUsers = new Set();

  for (const docSnap of todosSnap.docs) {
    const data = docSnap.data() || {};
    const userId = data.userId || data.uid || "";
    if (options.user && userId !== options.user) continue;

    todos.push({
      id: docSnap.id,
      data,
      userId,
    });

    if (userId && data.labelId) {
      labelUsers.add(userId);
    }
  }

  await Promise.all([...labelUsers].map((uid) => loadLabelsForUser(uid)));

  for (const { id, data, userId } of todos) {
    const logs = data.actualLogs || {};
    const assigned = data.assigned || {};
    const createdAt = toIso(data.createdAt);
    const deadline = toIso(data.deadline);
    const eacDate = toEacDate(data.eacDate);
    const labelId = data.labelId || "";
    const { name: labelName = "", color: labelColor = "" } = getLabelMeta(
      userId,
      labelId
    );

    taskRows.push({
      taskId: id,
      userId,
      text: data.text || "",
      createdAt,
      deadline,
      estimatedMinutes: numOrBlank(data.estimatedMinutes ?? 0),
      actualTotalMinutes: numOrBlank(data.actualTotalMinutes ?? 0),
      completed: data.completed ? "true" : "false",
      labelId,
      priority: data.priority ?? "",
      idealProgress: numOrBlank(data.idealProgress),
      actualProgress: numOrBlank(data.actualProgress),
      pace7d: numOrBlank(data.pace7d),
      paceExp: numOrBlank(data.paceExp),
      requiredPace: numOrBlank(data.requiredPace),
      requiredPaceAdj: numOrBlank(data.requiredPaceAdj),
      spi: numOrBlank(data.spi),
      spi7d: numOrBlank(data.spi7d),
      spiExp: numOrBlank(data.spiExp),
      spiAdj: numOrBlank(data.spiAdj),
      eacDate,
      riskLevel: data.riskLevel || "",
      labelName,
      labelColor,
    });

    for (const [date, minutes] of Object.entries(logs)) {
      if (!isWithinRange(date, options.from, options.to)) continue;

      dailyRows.push({
        taskId: id,
        userId,
        text: data.text || "",
        date,
        assignedMinutes: numOrBlank(assigned[date] ?? 0),
        actualMinutes: numOrBlank(minutes ?? 0),
        estimatedMinutes: numOrBlank(data.estimatedMinutes ?? 0),
        deadline,
        eacDate,
        completed: data.completed ? "true" : "false",
        labelId,
        labelName,
        labelColor,
      });
    }
  }

  const taskHeaders = [
    "taskId",
    "userId",
    "text",
    "createdAt",
    "deadline",
    "estimatedMinutes",
    "actualTotalMinutes",
    "completed",
    "labelId",
    "priority",
    "idealProgress",
    "actualProgress",
    "pace7d",
    "paceExp",
    "requiredPace",
    "requiredPaceAdj",
    "spi",
    "spi7d",
    "spiExp",
    "spiAdj",
    "eacDate",
    "riskLevel",
    "labelName",
    "labelColor",
  ];

  const dailyHeaders = [
    "taskId",
    "userId",
    "text",
    "date",
    "assignedMinutes",
    "actualMinutes",
    "estimatedMinutes",
    "deadline",
    "eacDate",
    "completed",
    "labelId",
    "labelName",
    "labelColor",
  ];

  const csvTasks = toCsv(taskRows, taskHeaders);
  const csvDaily = toCsv(dailyRows, dailyHeaders);

  fs.writeFileSync(path.join(options.outDir, "tasks.csv"), csvTasks, "utf8");
  fs.writeFileSync(
    path.join(options.outDir, "daily_progress.csv"),
    csvDaily,
    "utf8"
  );

  console.log(`✅ tasks.csv: ${taskRows.length} rows`);
  console.log(`✅ daily_progress.csv: ${dailyRows.length} rows`);
  console.log("=== Export Complete ===");
}

main().catch((err) => {
  console.error("Export failed", err);
  process.exit(1);
});
