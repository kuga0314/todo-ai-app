#!/usr/bin/env node
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import dotenv from "dotenv";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

dotenv.config({ path: path.join(__dirname, ".env") });

function loadServiceAccount() {
  const jsonInline = process.env.FIREBASE_ADMIN_KEY_JSON;
  if (jsonInline) return JSON.parse(jsonInline);

  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gacPath && fs.existsSync(gacPath)) {
    const raw = fs.readFileSync(gacPath, "utf8");
    return JSON.parse(raw);
  }

  const localPath = path.resolve("serviceAccountKey.json");
  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, "utf8");
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
  const options = { userId: null, start: null, end: null, preview: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--userId")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[i + 1];
      if (value) {
        options.userId = value;
        if (!arg.includes("=") && args[i + 1]) i += 1;
      }
    } else if (arg.startsWith("--start")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[i + 1];
      if (value) {
        options.start = value;
        if (!arg.includes("=") && args[i + 1]) i += 1;
      }
    } else if (arg.startsWith("--end")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[i + 1];
      if (value) {
        options.end = value;
        if (!arg.includes("=") && args[i + 1]) i += 1;
      }
    } else if (arg === "--preview") {
      options.preview = true;
    }
  }

  if (!options.userId || !options.start || !options.end) {
    console.error("Usage: node export_eac_events.js --userId=XXX --start=YYYY-MM-DD --end=YYYY-MM-DD [--preview]");
    process.exit(1);
  }
  return options;
}

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function parseDateKey(dateKey) {
  if (!dateKey) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateKey(date) {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

function addDays(date, delta) {
  const clone = new Date(date.getTime());
  clone.setUTCDate(clone.getUTCDate() + delta);
  return clone;
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
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function ensureExportsDir() {
  const outDir = path.resolve("exports");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

function round(num, decimals = 2) {
  return Math.round(num * 10 ** decimals) / 10 ** decimals;
}

function computePace7d(minutesSeries, index) {
  const start = Math.max(0, index - 6);
  let sum = 0;
  let daysWorked = 0;
  for (let i = start; i <= index; i += 1) {
    const v = Number(minutesSeries[i]) || 0;
    sum += v;
    if (v > 0) daysWorked += 1;
  }
  const denominator = Math.max(1, daysWorked < 3 ? daysWorked || 1 : 7);
  return sum / denominator;
}

function computeSpi({ pace7d, estimatedMinutes, cumulative, deadlineDate, currentDate }) {
  const remaining = Math.max(0, estimatedMinutes - cumulative);
  if (!deadlineDate) return { spi: null, remaining, requiredPace: null, daysLeft: null };

  const diff = Math.ceil((deadlineDate - currentDate) / (24 * 60 * 60 * 1000));
  const daysLeft = Math.max(1, diff);
  const requiredPace = remaining > 0 ? remaining / daysLeft : 0;
  let spi;
  if (requiredPace > 0) {
    spi = round(pace7d / requiredPace, 2);
  } else {
    spi = remaining === 0 ? 1 : 0;
  }
  return { spi, remaining, requiredPace, daysLeft };
}

function computeEac({ pace7d, remaining, currentDate, deadlineKey }) {
  if (remaining <= 0) {
    return { eacDateKey: toDateKey(currentDate), eacOverDeadline: false };
  }
  if (pace7d <= 0) {
    return { eacDateKey: null, eacOverDeadline: "" };
  }
  const daysToFinish = Math.ceil(remaining / pace7d);
  const eacDateKey = toDateKey(addDays(currentDate, daysToFinish));
  const eacOverDeadline = deadlineKey ? eacDateKey > deadlineKey : "";
  return { eacDateKey, eacOverDeadline };
}

function averageMinutesAround(dateRange, minutesSeries, eventIndex, direction) {
  let sum = 0;
  let count = 0;
  const step = direction === "before" ? -1 : 1;
  for (let i = 1; i <= 7; i += 1) {
    const idx = eventIndex + step * i;
    if (idx < 0 || idx >= dateRange.length) break;
    const v = Number(minutesSeries[idx]) || 0;
    sum += v;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

async function fetchTodos(userId) {
  const snap = await db.collection("todos").where("userId", "==", userId).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function fetchDailyPlans(userId, startKey, endKey) {
  const plansRef = db.collection(`users/${userId}/dailyPlans`);
  const snap = await plansRef.get();
  const map = new Map();
  snap.forEach((doc) => {
    const plan = doc.data() || {};
    const dateKey = plan.date || doc.id;
    if (!dateKey) return;
    if (dateKey < startKey || dateKey > endKey) return;
    map.set(dateKey, plan);
  });
  return map;
}

function buildDateRange(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) throw new Error("Invalid start or end date");
  const days = [];
  let current = start;
  while (current <= end) {
    days.push(toDateKey(current));
    current = addDays(current, 1);
  }
  return days;
}

function extractPlanInfo(plan, todoId) {
  if (!plan) return { hasPlan: false, planContainsThisTodo: false, planAllocatedMinutes: "" };
  const items = Array.isArray(plan.items) ? plan.items : [];
  const matched = items.find((item) => item?.todoId === todoId);
  return {
    hasPlan: true,
    planContainsThisTodo: Boolean(matched),
    planAllocatedMinutes: matched?.plannedMinutes ?? "",
  };
}

async function main() {
  const options = parseArgs();
  const { userId, start, end, preview } = options;

  const dateRange = buildDateRange(start, end);
  const todos = await fetchTodos(userId);
  const plansByDate = await fetchDailyPlans(userId, start, end);

  console.log(`[info] fetched todos: ${todos.length}`);
  console.log(`[info] dateRange length: ${dateRange.length}`);

  const dailyHeaders = [
    "userId",
    "todoId",
    "dateKey",
    "deadlineKey",
    "estimatedMinutes",
    "minutes",
    "cumMinutes",
    "pace7d",
    "spi",
    "eacDateKey",
    "eacOverDeadline",
    "completed",
    "hasPlan",
    "planContainsThisTodo",
    "planAllocatedMinutes",
  ];

  const eventHeaders = [
    "userId",
    "todoId",
    "eventDateKey",
    "deadlineKey",
    "estimatedMinutes",
    "eacDateKey_at_event",
    "minutes_before_7d_avg",
    "minutes_after_7d_avg",
    "delta_minutes_7d",
    "pace7d_at_event",
    "spi_at_event",
    "hasPlan_at_event",
    "planContainsThisTodo_at_event",
    "notes",
  ];

  const dailyRows = [];
  const eventRows = [];
  let nullEacCount = 0;

  for (const { id: todoId, data } of todos) {
    const estimatedMinutes = Number(data.estimatedMinutes) || 0;
    const deadlineDate = toDate(data.deadline);
    const deadlineKey = deadlineDate ? toDateKey(deadlineDate) : "";
    const actualLogs = data.actualLogs || {};
    const completed = Boolean(data.completed);

    const minutesSeries = dateRange.map((dateKey) => Number(actualLogs[dateKey]) || 0);
    const cumulativeSeries = [];
    let cumulative = 0;
    let prevOverDeadlineKnown = false;
    let prevOverDeadline = false;

    for (let idx = 0; idx < dateRange.length; idx += 1) {
      const dateKey = dateRange[idx];
      const minutes = minutesSeries[idx];
      cumulative += minutes;
      cumulativeSeries.push(cumulative);

      const pace7d = computePace7d(minutesSeries, idx);
      const currentDate = parseDateKey(dateKey);
      const { spi, remaining } = computeSpi({
        pace7d,
        estimatedMinutes,
        cumulative,
        deadlineDate,
        currentDate,
      });

      const { eacDateKey, eacOverDeadline } = computeEac({
        pace7d,
        remaining,
        currentDate,
        deadlineKey,
      });

      if (eacDateKey === null) nullEacCount += 1;

      const plan = plansByDate.get(dateKey);
      const planInfo = extractPlanInfo(plan, todoId);

      dailyRows.push({
        userId,
        todoId,
        dateKey,
        deadlineKey,
        estimatedMinutes,
        minutes,
        cumMinutes: cumulative,
        pace7d,
        spi,
        eacDateKey,
        eacOverDeadline,
        completed,
        hasPlan: planInfo.hasPlan,
        planContainsThisTodo: planInfo.planContainsThisTodo,
        planAllocatedMinutes: planInfo.planAllocatedMinutes,
      });

      if (eacDateKey !== null) {
        if (prevOverDeadlineKnown && prevOverDeadline === false && eacOverDeadline === true) {
          const beforeAvg = averageMinutesAround(dateRange, minutesSeries, idx, "before");
          const afterAvg = averageMinutesAround(dateRange, minutesSeries, idx, "after");
          const delta =
            beforeAvg !== null && afterAvg !== null ? afterAvg - beforeAvg : "";

          eventRows.push({
            userId,
            todoId,
            eventDateKey: dateKey,
            deadlineKey,
            estimatedMinutes,
            eacDateKey_at_event: eacDateKey,
            minutes_before_7d_avg: beforeAvg,
            minutes_after_7d_avg: afterAvg,
            delta_minutes_7d: delta,
            pace7d_at_event: pace7d,
            spi_at_event: spi,
            hasPlan_at_event: planInfo.hasPlan,
            planContainsThisTodo_at_event: planInfo.planContainsThisTodo,
            notes: "",
          });
        }
        prevOverDeadlineKnown = true;
        prevOverDeadline = eacOverDeadline === true;
      }
    }
  }

  const outDir = ensureExportsDir();
  const dailyPath = path.join(outDir, "eac_daily.csv");
  const eventsPath = path.join(outDir, "eac_events.csv");

  fs.writeFileSync(dailyPath, toCsv(dailyRows, dailyHeaders));
  fs.writeFileSync(eventsPath, toCsv(eventRows, eventHeaders));

  console.log(`[info] eac_daily rows: ${dailyRows.length}`);
  console.log(`[info] eac_events rows: ${eventRows.length}`);
  console.log(`[info] null EAC rows: ${nullEacCount}`);

  if (preview) {
    console.log("--- eac_daily preview (top 5) ---");
    dailyRows.slice(0, 5).forEach((row) => {
      console.log(dailyHeaders.map((h) => row[h]).join(","));
    });
    console.log("--- eac_events preview (top 5) ---");
    eventRows.slice(0, 5).forEach((row) => {
      console.log(eventHeaders.map((h) => row[h]).join(","));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
