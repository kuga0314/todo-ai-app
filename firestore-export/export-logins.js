const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (err) {
  if (err?.code !== "MODULE_NOT_FOUND") throw err;
}

function loadServiceAccount() {
  const inline = process.env.FIREBASE_ADMIN_KEY_JSON;
  if (inline) {
    return JSON.parse(inline);
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    const raw = fs.readFileSync(credentialsPath, "utf8");
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

function ensureAggregator(map, userId) {
  if (!map.has(userId)) {
    map.set(userId, {
      userId,
      totalLogins: 0,
      firstLoginAt: null,
      lastLoginAt: null,
      storedLoginCount: null,
    });
  }
  return map.get(userId);
}

function shouldInclude(dateKey, from, to) {
  if (!from && !to) return true;
  if (!dateKey) return false;
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

async function loadUserIds(userFilter) {
  if (userFilter) {
    return [userFilter];
  }

  const snap = await db.collection("users").get();
  return snap.docs.map((docSnap) => docSnap.id);
}

async function main() {
  const options = parseArgs();

  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  const userIds = await loadUserIds(options.user);
  if (!userIds.length) {
    console.log("No users found. Nothing to export.");
    return;
  }

  console.log(`Exporting login events for ${userIds.length} user(s)...`);

  const loginRows = [];
  const aggregated = new Map();

  for (const uid of userIds) {
    const agg = ensureAggregator(aggregated, uid);

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        if (typeof data.loginCount === "number") {
          agg.storedLoginCount = data.loginCount;
        }
      }
    } catch (err) {
      console.warn(`⚠️ failed to read user document for ${uid}:`, err?.message || err);
    }

    let loginsSnap;
    try {
      loginsSnap = await db.collection("users").doc(uid).collection("logins").get();
    } catch (err) {
      console.warn(`⚠️ failed to read login logs for ${uid}:`, err?.message || err);
      continue;
    }

    loginsSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const createdDate = toDate(data.createdAt);
      if (!createdDate) {
        return;
      }

      const iso = createdDate.toISOString();
      const dateKey = iso.slice(0, 10);
      if (!shouldInclude(dateKey, options.from, options.to)) {
        return;
      }

      loginRows.push({
        userId: uid,
        loginAt: iso,
        dateKey,
        source: data.source || "",
        agent: data.agent || "",
      });

      agg.totalLogins += 1;
      if (!agg.firstLoginAt || iso < agg.firstLoginAt) {
        agg.firstLoginAt = iso;
      }
      if (!agg.lastLoginAt || iso > agg.lastLoginAt) {
        agg.lastLoginAt = iso;
      }
    });
  }

  loginRows.sort((a, b) => {
    if (a.userId === b.userId) {
      return a.loginAt.localeCompare(b.loginAt);
    }
    return a.userId.localeCompare(b.userId);
  });

  const countRows = [...aggregated.values()].map((entry) => ({
    userId: entry.userId,
    totalLogins: entry.totalLogins,
    firstLoginAt: entry.firstLoginAt || "",
    lastLoginAt: entry.lastLoginAt || "",
  }));

  countRows.sort((a, b) => a.userId.localeCompare(b.userId));

  if (!options.from && !options.to) {
    for (const entry of aggregated.values()) {
      if (
        typeof entry.storedLoginCount === "number" &&
        entry.totalLogins !== entry.storedLoginCount
      ) {
        console.warn(
          `⚠️ loginCount mismatch for ${entry.userId}: field=${entry.storedLoginCount}, events=${entry.totalLogins}`
        );
      }
    }
  }

  const loginsPath = path.join(options.outDir, "logins.csv");
  const countsPath = path.join(options.outDir, "login_counts.csv");

  fs.writeFileSync(
    loginsPath,
    toCsv(loginRows, ["userId", "loginAt", "dateKey", "source", "agent"]),
    "utf8"
  );
  fs.writeFileSync(
    countsPath,
    toCsv(countRows, ["userId", "totalLogins", "firstLoginAt", "lastLoginAt"]),
    "utf8"
  );

  console.log(`Exported ${loginRows.length} login event(s) to ${loginsPath}`);
  console.log(`Exported ${countRows.length} aggregation row(s) to ${countsPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Export failed:", err);
    process.exitCode = 1;
  });
}
