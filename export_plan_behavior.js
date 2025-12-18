import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

function loadServiceAccount() {
  if (process.env.FIREBASE_ADMIN_KEY_JSON) {
    return JSON.parse(process.env.FIREBASE_ADMIN_KEY_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return null; // use application default credentials
  }

  const credentialsPath = path.resolve("serviceAccountKey.json");
  if (fs.existsSync(credentialsPath)) {
    const raw = fs.readFileSync(credentialsPath, "utf8");
    return JSON.parse(raw);
  }

  throw new Error(
    "Missing credentials: set FIREBASE_ADMIN_KEY_JSON, GOOGLE_APPLICATION_CREDENTIALS, or place serviceAccountKey.json"
  );
}

function initializeFirebase() {
  const serviceAccount = loadServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: serviceAccount
        ? admin.credential.cert(serviceAccount)
        : admin.credential.applicationDefault(),
    });
  }
  return admin.firestore();
}

const db = initializeFirebase();
const FieldPath = admin.firestore.FieldPath;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    outDir: "./exports",
    includeRevisions: false,
    preview: false,
    allUsers: false,
    userId: null,
    start: null,
    end: null,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--start=")) {
      options.start = arg.replace("--start=", "");
    } else if (arg.startsWith("--end=")) {
      options.end = arg.replace("--end=", "");
    } else if (arg.startsWith("--outDir=")) {
      options.outDir = arg.replace("--outDir=", "");
    } else if (arg === "--includeRevisions") {
      options.includeRevisions = true;
    } else if (arg === "--preview") {
      options.preview = true;
    } else if (arg === "--allUsers") {
      options.allUsers = true;
    } else if (arg.startsWith("--userId=")) {
      options.userId = arg.replace("--userId=", "");
    }
  });

  if (!options.start || !options.end) {
    throw new Error("--start and --end are required (YYYY-MM-DD)");
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(options.start) || !datePattern.test(options.end)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  if (!options.allUsers && !options.userId) {
    throw new Error("Specify --allUsers or --userId for the target scope");
  }

  return options;
}

function normalizeDateKey(value) {
  if (!value) return "";
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (str.includes("/")) {
    const replaced = str.replace(/\//g, "-");
    if (/^\d{4}-\d{2}-\d{2}$/.test(replaced)) return replaced;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return str;
}

function csvEscape(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildKey(userId, dateKey, todoId) {
  return [userId || "", dateKey || "", todoId || ""].join("|||");
}

function splitKey(composite) {
  const [userId, dateKey, todoId] = composite.split("|||");
  return { userId, dateKey, todoId };
}

async function fetchUserIds(options) {
  if (options.userId) return [options.userId];

  const userIds = [];
  const pageSize = 500;
  let lastDoc = null;

  while (true) {
    let query = db.collection("users").orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snap = await query.get();
    snap.docs.forEach((doc) => userIds.push(doc.id));
    if (snap.docs.length < pageSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return userIds;
}

async function fetchDailyPlans(userId, start, end) {
  const plansRef = db.collection("users").doc(userId).collection("dailyPlans");
  const snap = await plansRef
    .where(FieldPath.documentId(), ">=", start)
    .where(FieldPath.documentId(), "<=", end)
    .orderBy(FieldPath.documentId())
    .get();
  return snap.docs;
}

async function fetchPlanRevisions(planDoc) {
  try {
    return await planDoc.ref.collection("revisions").orderBy("changedAt", "asc").get();
  } catch (error) {
    return await planDoc.ref.collection("revisions").get();
  }
}

function collectPlanItems(userId, planDoc) {
  const data = planDoc.data() || {};
  const dateKey = normalizeDateKey(data.date || planDoc.id);
  const capMinutes = data.capMinutes ?? "";
  const items = Array.isArray(data.items) ? data.items : [];

  const rows = items.map((item) => ({
    userId,
    dateKey,
    capMinutes,
    todoId: item?.todoId ?? "",
    plannedMinutes: item?.plannedMinutes ?? "",
    requiredMinutes: item?.requiredMinutes ?? "",
    order: item?.order ?? "",
    title: item?.title ?? "",
  }));

  return { rows, dateKey, capMinutes, items };
}

function collectRevisionItems(userId, dateKey, revisionsSnap) {
  const rows = [];
  revisionsSnap?.forEach((revDoc) => {
    const data = revDoc.data() || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const capMinutes = data.capMinutes ?? "";
    const revisedAt =
      data.changedAt || data.updatedAt || data.createdAt || data.revisedAt || null;

    items.forEach((item) => {
      rows.push({
        userId,
        dateKey,
        revisionId: revDoc.id,
        revisedAt,
        capMinutes,
        todoId: item?.todoId ?? "",
        plannedMinutes: item?.plannedMinutes ?? "",
        requiredMinutes: item?.requiredMinutes ?? "",
        order: item?.order ?? "",
        title: item?.title ?? "",
      });
    });
  });
  return rows;
}

async function fetchActualLogs(userId, start, end) {
  const snap = await db.collection("todos").where("userId", "==", userId).get();
  const map = new Map();

  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const title = data.text || "";
    const todoId = doc.id;
    const logs = data.actualLogs || {};

    Object.entries(logs).forEach(([rawDate, value]) => {
      const dateKey = normalizeDateKey(rawDate);
      if (!dateKey) return;
      if (dateKey < start || dateKey > end) return;
      const minutes = Number(value);
      if (!Number.isFinite(minutes)) return;

      const key = buildKey(userId, dateKey, todoId);
      const existing = map.get(key) || { actualMinutes: 0, title };
      existing.actualMinutes += minutes;
      if (!existing.title) existing.title = title;
      map.set(key, existing);
    });
  });

  return map;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function previewCsv(label, rows, limit = 5) {
  if (!rows.length) {
    console.log(`[preview] ${label}: (no rows)`);
    return;
  }
  console.log(`[preview] ${label}:`);
  rows.slice(0, limit).forEach((row) => {
    console.log("  ", row.join(","));
  });
}

function compareUserDateTodo(a, b) {
  if (a[0] !== b[0]) return String(a[0]).localeCompare(String(b[0]));
  if (a[1] !== b[1]) return String(a[1]).localeCompare(String(b[1]));
  return String(a[2]).localeCompare(String(b[2]));
}

async function main() {
  const options = parseArgs();
  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  const userIds = await fetchUserIds(options);
  const planItems = [];
  const planMap = new Map();
  const actualMap = new Map();
  const revisionItems = [];
  const dateSet = new Set();

  for (const userId of userIds) {
    const plans = await fetchDailyPlans(userId, options.start, options.end);
    for (const planDoc of plans) {
      const { rows, dateKey, capMinutes } = collectPlanItems(userId, planDoc);
      if (dateKey) {
        dateSet.add(dateKey);
      }
      rows.forEach((row) => {
        planItems.push(row);
        const key = buildKey(row.userId, row.dateKey, row.todoId);
        planMap.set(key, {
          plannedMinutes: row.plannedMinutes ?? 0,
          requiredMinutes: row.requiredMinutes ?? "",
          capMinutes,
          order: row.order ?? "",
          title: row.title ?? "",
        });
      });
      if (rows.length) {
        dateSet.add(dateKey);
      }

      if (options.includeRevisions) {
        const revisionsSnap = await fetchPlanRevisions(planDoc);
        const revisionRows = collectRevisionItems(userId, dateKey, revisionsSnap);
        revisionRows.forEach((row) => {
          revisionItems.push(row);
        });
      }
    }

    const actualLogsMap = await fetchActualLogs(userId, options.start, options.end);
    actualLogsMap.forEach((value, key) => {
      actualMap.set(key, value);
      const { dateKey } = splitKey(key);
      dateSet.add(dateKey);
    });
  }

  const actualRows = [];
  actualMap.forEach((value, key) => {
    const { userId, dateKey, todoId } = splitKey(key);
    actualRows.push([
      userId,
      dateKey,
      todoId,
      value.actualMinutes ?? 0,
    ]);
  });

  const joinRows = [];
  const joinKeys = new Set([...planMap.keys(), ...actualMap.keys()]);
  joinKeys.forEach((key) => {
    const { userId, dateKey, todoId } = splitKey(key);
    const plan = planMap.get(key);
    const actual = actualMap.get(key);
    joinRows.push([
      userId,
      dateKey,
      todoId,
      plan ? "true" : "false",
      plan ? plan.plannedMinutes ?? 0 : 0,
      actual ? actual.actualMinutes ?? 0 : 0,
      plan?.capMinutes ?? "",
      plan?.order ?? "",
      plan?.title ?? actual?.title ?? "",
    ]);
  });

  const planRows = planItems.map((row) => [
    row.userId,
    row.dateKey,
    row.capMinutes,
    row.todoId,
    row.plannedMinutes,
    row.requiredMinutes,
    row.order,
    row.title,
  ]);

  const revisionRows = revisionItems.map((row) => [
    row.userId,
    row.dateKey,
    row.revisionId,
    row.revisedAt || "",
    row.capMinutes,
    row.todoId,
    row.plannedMinutes,
    row.requiredMinutes,
    row.order,
    row.title,
  ]);

  planRows.sort(compareUserDateTodo);
  actualRows.sort(compareUserDateTodo);
  joinRows.sort(compareUserDateTodo);
  revisionRows.sort((a, b) => {
    const base = compareUserDateTodo(a, b);
    if (base !== 0) return base;
    if (a[2] !== b[2]) return String(a[2]).localeCompare(String(b[2]));
    return String(a[4]).localeCompare(String(b[4]));
  });

  const planFile = path.join(options.outDir, "plan_items.csv");
  const actualFile = path.join(options.outDir, "actual_by_todo_day.csv");
  const joinFile = path.join(options.outDir, "plan_actual_join.csv");
  const revisionFile = path.join(options.outDir, "plan_revisions_items.csv");

  writeCsv(planFile, [
    "userId",
    "dateKey",
    "capMinutes",
    "todoId",
    "plannedMinutes",
    "requiredMinutes",
    "order",
    "title",
  ], planRows);

  writeCsv(actualFile, [
    "userId",
    "dateKey",
    "todoId",
    "actualMinutes",
  ], actualRows);

  writeCsv(joinFile, [
    "userId",
    "dateKey",
    "todoId",
    "isPlanned",
    "plannedMinutes",
    "actualMinutes",
    "capMinutes",
    "order",
    "title",
  ], joinRows);

  if (options.includeRevisions) {
    writeCsv(revisionFile, [
      "userId",
      "dateKey",
      "revisionId",
      "revisedAt",
      "capMinutes",
      "todoId",
      "plannedMinutes",
      "requiredMinutes",
      "order",
      "title",
    ], revisionRows);
  }

  console.log("=== export complete ===");
  console.log("users:", userIds.length);
  console.log("dates:", dateSet.size);
  console.log("plan_items rows:", planRows.length);
  console.log("actual_by_todo_day rows:", actualRows.length);
  console.log("plan_actual_join rows:", joinRows.length);

  if (options.includeRevisions) {
    console.log("plan_revisions_items rows:", revisionRows.length);
  }

  if (options.preview) {
    previewCsv("plan_items", [
      ["userId", "dateKey", "capMinutes", "todoId", "plannedMinutes", "requiredMinutes", "order", "title"],
      ...planRows,
    ]);
    previewCsv("actual_by_todo_day", [
      ["userId", "dateKey", "todoId", "actualMinutes"],
      ...actualRows,
    ]);
    previewCsv("plan_actual_join", [
      ["userId", "dateKey", "todoId", "isPlanned", "plannedMinutes", "actualMinutes", "capMinutes", "order", "title"],
      ...joinRows,
    ]);

    if (options.includeRevisions) {
      previewCsv("plan_revisions_items", [
        ["userId", "dateKey", "revisionId", "revisedAt", "capMinutes", "todoId", "plannedMinutes", "requiredMinutes", "order", "title"],
        ...revisionRows,
      ]);
    }
  }
}

main().catch((error) => {
  console.error("Export failed", error);
  process.exitCode = 1;
});
