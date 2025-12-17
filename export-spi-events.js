const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (err) {
  if (err?.code !== "MODULE_NOT_FOUND") throw err;
}

function loadServiceAccount() {
  const jsonInline = process.env.FIREBASE_ADMIN_KEY_JSON;
  if (jsonInline) return JSON.parse(jsonInline);

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

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outPath: path.resolve("spi_events.csv"),
    user: null,
    minStreak: 1,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out" && args[i + 1]) {
      options.outPath = path.resolve(args[i + 1]);
      i += 1;
    } else if (arg === "--user" && args[i + 1]) {
      options.user = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--minStreak")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[i + 1];
      if (value !== undefined) {
        options.minStreak = Number(value) || 1;
        if (!arg.includes("=") && args[i + 1]) i += 1;
      }
    }
  }

  if (!options.user) {
    console.warn("[warn] --user is not specified; exporting all todos may be slow.");
  }

  return options;
}

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function parseJstDateKey(key) {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toJstDateKey(date) {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

function addDays(date, delta) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[,"\n]/.test(str)) {
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

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  const ts = Date.parse(value);
  if (!Number.isNaN(ts)) return new Date(ts);
  return null;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : "";
}

function findEventDate(metricsByDate = {}, { threshold = 1.0, minStreak = 1 } = {}) {
  const entries = Object.entries(metricsByDate)
    .filter(([date, value]) => {
      if (!date || !value) return false;
      const spi = Number(value.spi);
      return Number.isFinite(spi) && spi < threshold;
    })
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;

  if (minStreak <= 1) return entries[0][0];

  let streakCount = 0;
  let streakStart = null;

  for (let i = 0; i < entries.length; i += 1) {
    const [dateStr] = entries[i];
    const currentDate = parseJstDateKey(dateStr);
    const prevDate = i > 0 ? parseJstDateKey(entries[i - 1][0]) : null;

    if (
      prevDate &&
      currentDate &&
      currentDate.getTime() - prevDate.getTime() === 24 * 60 * 60 * 1000
    ) {
      streakCount += 1;
    } else {
      streakCount = 1;
      streakStart = dateStr;
    }

    if (streakCount === 1) {
      streakStart = dateStr;
    }

    if (streakCount >= minStreak && streakStart) {
      return streakStart;
    }
  }

  return null;
}

function averageWorkAroundEvent(logs = {}, eventDateKey) {
  const eventDate = parseJstDateKey(eventDateKey);
  if (!eventDate) return { before: null, after: null };

  let beforeSum = 0;
  let afterSum = 0;
  for (let i = 1; i <= 7; i += 1) {
    const beforeKey = toJstDateKey(addDays(eventDate, -i));
    const afterKey = toJstDateKey(addDays(eventDate, i));
    beforeSum += Number(logs?.[beforeKey]) || 0;
    afterSum += Number(logs?.[afterKey]) || 0;
  }
  return {
    before: beforeSum / 7,
    after: afterSum / 7,
  };
}

function extractEacDate(metricsByDate = {}, eventDate) {
  const raw = metricsByDate?.[eventDate]?.eacDate;
  const date = toDate(raw);
  if (!date) return { eventEacDate: "", eventEacTs: "" };
  return {
    eventEacDate: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    eventEacTs: date.getTime(),
  };
}

function daysToDeadline(eventDateKey, deadlineRaw) {
  const eventDate = parseJstDateKey(eventDateKey);
  const deadlineDate = toDate(deadlineRaw);
  if (!eventDate || !deadlineDate) return "";
  const diffDays = Math.floor((deadlineDate - eventDate) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 ? diffDays : "";
}

async function fetchTodos(userId) {
  try {
    let ref = db.collection("todos");
    if (userId) {
      ref = ref.where("userId", "==", userId);
    }
    const snap = await ref.get();
    if (snap.empty) {
      console.warn("[warn] No todos found for the specified query.");
    }
    return snap.docs;
  } catch (err) {
    console.error("[error] Failed to fetch todos", err);
    throw err;
  }
}

async function main() {
  const options = parseArgs();
  const rows = [];

  const todosDocs = await fetchTodos(options.user);

  for (const docSnap of todosDocs) {
    const data = docSnap.data() || {};
    const userId = data.userId || data.uid || "";

    const eventDate = findEventDate(data.metricsByDate || {}, {
      threshold: 1.0,
      minStreak: Math.max(1, options.minStreak || 1),
    });
    if (!eventDate) continue;

    const { before, after } = averageWorkAroundEvent(data.actualLogs, eventDate);
    const deltaMinutes7d =
      before == null || after == null ? "" : Number(after) - Number(before);

    const { eventEacDate, eventEacTs } = extractEacDate(data.metricsByDate, eventDate);
    const deadlineIso = toIso(data.deadline);

    rows.push({
      todoId: docSnap.id,
      text: data.text || "",
      userId,
      eventDate,
      eventSpi: data.metricsByDate?.[eventDate]?.spi ?? "",
      avgMinutesBefore7d: before == null ? "" : before,
      avgMinutesAfter7d: after == null ? "" : after,
      deltaMinutes7d,
      estimatedMinutes: Number(data.estimatedMinutes) || "",
      deadline: deadlineIso,
      eventEacDate,
      eventEacTs,
      daysToDeadlineAtEvent: daysToDeadline(eventDate, data.deadline),
    });
  }

  rows.sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const headers = [
    "todoId",
    "text",
    "userId",
    "eventDate",
    "eventSpi",
    "avgMinutesBefore7d",
    "avgMinutesAfter7d",
    "deltaMinutes7d",
    "estimatedMinutes",
    "deadline",
    "eventEacDate",
    "eventEacTs",
    "daysToDeadlineAtEvent",
  ];

  const csv = toCsv(rows, headers);
  fs.writeFileSync(options.outPath, csv, "utf8");

  console.log(`Exported ${rows.length} SPI events to ${options.outPath}`);
}

main().catch((err) => {
  console.error("Export failed", err);
  process.exitCode = 1;
});
