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

async function main() {
  const args = process.argv.slice(2);
  let outDir = process.cwd();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out" && args[i + 1]) {
      outDir = path.resolve(args[i + 1]);
      i += 1;
    }
  }
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log("=== Firestore Sessions Export Start ===");

  const todosSnap = await db.collection("todos").get();
  const rows = [];

  for (const docSnap of todosSnap.docs) {
    const todo = docSnap.data() || {};
    const sessionsSnap = await docSnap.ref.collection("sessions").get();
    sessionsSnap.forEach((sessionSnap) => {
      const session = sessionSnap.data() || {};
      rows.push({
        taskId: docSnap.id,
        userId: todo.userId || todo.uid || "",
        text: todo.text || "",
        date: session.date || "",
        minutes: numOrBlank(session.minutes),
        source: session.source || "",
        trigger: session.trigger || "",
        createdAt: toDate(session.createdAt)?.toISOString() || "",
      });
    });
  }

  const headers = [
    "taskId",
    "userId",
    "text",
    "date",
    "minutes",
    "source",
    "trigger",
    "createdAt",
  ];

  const csv = toCsv(rows, headers);
  fs.writeFileSync(path.join(outDir, "sessions.csv"), csv, "utf8");

  console.log(`✅ sessions.csv: ${rows.length} rows`);
  console.log("=== Export Complete ===");
}

main().catch((err) => {
  console.error("Export failed", err);
  process.exit(1);
});
