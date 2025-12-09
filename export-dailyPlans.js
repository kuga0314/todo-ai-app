// node export-dailyPlans.js
// Export all daily plan items from Firestore into a CSV file.

import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  getFirestore,
} from "firebase/firestore/lite";

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

  const rows = (items.length ? items : [null]).map((item) => {
    const todoId = item?.todoId ?? "";
    const todoOrder = item?.order ?? "";
    const todoTitle = item?.title ?? "";
    const todoPlannedMinutes = item?.plannedMinutes ?? "";
    const todoRequiredMinutes = item?.requiredMinutes ?? "";
    const todoLabelColor = item?.labelColor ?? "";

    const row = [
      meta.userId,
      meta.dateKey,
      viewType,
      meta.revisionIndex ?? "",
      meta.planChangedAt || "",
      normalizeValue(capMinutes),
      normalizeValue(totalPlannedMinutes),
      todoId,
      todoOrder,
      todoTitle,
      todoPlannedMinutes,
      todoRequiredMinutes,
      todoLabelColor,
    ]
      .map(csvEscape)
      .join(",");

    return row;
  });

  return rows;
}

function sortRows(rows) {
  const viewOrder = {
    initial: 0,
    before: 1,
    after: 2,
    current: 3,
  };

  return rows.sort((a, b) => {
    const aCols = a.split(",");
    const bCols = b.split(",");

    const aUserId = aCols[0];
    const bUserId = bCols[0];
    if (aUserId !== bUserId) return aUserId.localeCompare(bUserId);

    const aDate = aCols[1];
    const bDate = bCols[1];
    if (aDate !== bDate) return aDate.localeCompare(bDate);

    const aChanged = aCols[4] || "";
    const bChanged = bCols[4] || "";
    if (aChanged !== bChanged) {
      if (!aChanged) return 1;
      if (!bChanged) return -1;
      return aChanged.localeCompare(bChanged);
    }

    const aView = viewOrder[aCols[2]] ?? 999;
    const bView = viewOrder[bCols[2]] ?? 999;
    if (aView !== bView) return aView - bView;

    const aOrder = Number(aCols[8]) || 0;
    const bOrder = Number(bCols[8]) || 0;
    return aOrder - bOrder;
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

  for (const planDoc of docs) {
    const data = planDoc.data() || {};
    const userId = extractUserId(planDoc, data);
    const dateKey = extractDateKey(planDoc, data);
    const planChangedAt = extractChangedAt(data);

    const baseMeta = {
      userId,
      dateKey,
      planChangedAt,
      revisionIndex: "",
    };

    rows.push(
      ...buildRows(
        "current",
        {
          capMinutes: data.capMinutes,
          totalPlannedMinutes: data.totalPlannedMinutes,
          items: data.items,
        },
        baseMeta
      )
    );

    const revisionsSnap = await planDoc.ref
      .collection("revisions")
      .orderBy("changedAt", "asc")
      .get();

    if (!revisionsSnap.empty) {
      const revisionDocs = revisionsSnap.docs;

      const firstRevData = revisionDocs[0].data();
      const firstChangedAt = formatTimestamp(firstRevData.changedAt);
      rows.push(
        ...buildRows("initial", firstRevData.before, {
          ...baseMeta,
          planChangedAt: firstChangedAt,
          revisionIndex: 0,
        })
      );

      revisionDocs.forEach((revDoc, idx) => {
        const revData = revDoc.data();
        const changedAt = formatTimestamp(revData.changedAt);
        const revIndex = idx + 1;

        rows.push(
          ...buildRows("before", revData.before, {
            ...baseMeta,
            planChangedAt: changedAt,
            revisionIndex: revIndex,
          })
        );
        rows.push(
          ...buildRows("after", revData.after, {
            ...baseMeta,
            planChangedAt: changedAt,
            revisionIndex: revIndex,
          })
        );
      });
    }
  }

  const sorted = sortRows(rows);
  const headers = [
    "userId",
    "date",
    "viewType",
    "revisionIndex",
    "planChangedAt",
    "planCapMinutes",
    "planTotalPlannedMinutes",
    "todoId",
    "todoOrder",
    "todoTitle",
    "todoPlannedMinutes",
    "todoRequiredMinutes",
    "todoLabelColor",
  ];

  const csvLines = [headers.join(",")];
  sorted.forEach((row) => {
    csvLines.push(row);
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
