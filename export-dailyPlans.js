// node export-dailyPlans.js
// Export all daily plan items from Firestore into a CSV file.

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

function formatTimestamp(value) {
  return toISOString(value);
}

function buildRows(viewType, plan, meta) {
  const capMinutes = plan?.capMinutes;
  const totalPlannedMinutes = plan?.totalPlannedMinutes;
  const items = Array.isArray(plan?.items) ? plan.items : [];

  if (!items.length) {
    return [
      {
        ...meta,
        viewType,
        planCapMinutes: capMinutes,
        planTotalMinutes: totalPlannedMinutes,
        todoId: "",
        title: "",
        plannedMinutes: "",
        requiredMinutes: "",
        order: "",
        labelColor: "",
      },
    ];
  }

  return items.map((item) => ({
    ...meta,
    viewType,
    planCapMinutes: capMinutes,
    planTotalMinutes: totalPlannedMinutes,
    todoId: item?.todoId ?? "",
    title: item?.title ?? "",
    plannedMinutes: item?.plannedMinutes ?? "",
    requiredMinutes: item?.requiredMinutes ?? "",
    order: item?.order ?? "",
    labelColor: item?.labelColor ?? "",
  }));
}

function sortRows(rows) {
  const viewOrder = { before: 0, current: 1, after: 2 };
  return rows.sort((a, b) => {
    return (
      normalizeValue(a.userId).localeCompare(normalizeValue(b.userId)) ||
      normalizeValue(a.date).localeCompare(normalizeValue(b.date)) ||
      (viewOrder[a.viewType] ?? 99) - (viewOrder[b.viewType] ?? 99) ||
      Number(a.order || 0) - Number(b.order || 0)
    );
  });
}

function formatFilename(date = new Date()) {
  const pad = (num) => String(num).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `dailyPlans_export_${year}${month}${day}_${hours}${minutes}${seconds}.csv`;
}

async function fetchDailyPlans() {
  const snapshot = await db.collectionGroup("dailyPlans").get();
  return snapshot.docs;
}

function extractUserId(doc, data) {
  return data.userId || doc.ref.parent?.parent?.id || "";
}

function extractDateKey(doc, data) {
  return data.date || doc.id;
}

function extractChangedAt(data) {
  if (data?.lastChange) {
    return formatTimestamp(data.lastChange.changedAt || data.changedAt || data.updatedAt);
  }
  return formatTimestamp(data?.updatedAt);
}

async function main() {
  const docs = await fetchDailyPlans();
  const rows = [];

  docs.forEach((doc) => {
    const data = doc.data() || {};
    const userId = extractUserId(doc, data);
    const date = extractDateKey(doc, data);
    const planChangedAt = extractChangedAt(data);
    const planSource = data.source ?? "";

    const meta = {
      userId,
      date,
      planChangedAt,
      planSource,
    };

    rows.push(
      ...buildRows(
        "current",
        {
          capMinutes: data.capMinutes,
          totalPlannedMinutes: data.totalPlannedMinutes,
          items: data.items,
        },
        meta
      )
    );

    const lastChange = data.lastChange;

    if (lastChange?.before) {
      rows.push(
        ...buildRows(
          "before",
          {
            capMinutes: lastChange.before.capMinutes,
            totalPlannedMinutes: lastChange.before.totalPlannedMinutes,
            items: lastChange.before.items,
          },
          meta
        )
      );
    }

    if (lastChange?.after) {
      rows.push(
        ...buildRows(
          "after",
          {
            capMinutes: lastChange.after.capMinutes,
            totalPlannedMinutes: lastChange.after.totalPlannedMinutes,
            items: lastChange.after.items,
          },
          meta
        )
      );
    }
  });

  const sorted = sortRows(rows);
  const headers = [
    "userId",
    "date",
    "viewType",
    "planCapMinutes",
    "planTotalMinutes",
    "planChangedAt",
    "planSource",
    "todoId",
    "title",
    "plannedMinutes",
    "requiredMinutes",
    "order",
    "labelColor",
  ];

  const csvLines = [headers.join(",")];
  sorted.forEach((row) => {
    const line = headers.map((key) => csvEscape(row[key])).join(",");
    csvLines.push(line);
  });

  const filename = formatFilename();
  const outputPath = path.resolve(filename);
  fs.writeFileSync(outputPath, csvLines.join("\n"), "utf8");

  console.log(`Exported ${sorted.length} rows to ${filename}`);
}

main().catch((err) => {
  console.error("Failed to export dailyPlans:", err);
  process.exit(1);
});
