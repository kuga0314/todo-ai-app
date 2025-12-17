// node export-firestore-all.js --out ./export/full
// Export every Firestore collection (including nested subcollections)
// into CSV files. Requires a local serviceAccountKey.json.

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

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { outDir: path.resolve("export/full") };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out" && args[i + 1]) {
      options.outDir = path.resolve(args[i + 1]);
      i += 1;
    }
  }

  return options;
}

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toSerializable(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof admin.firestore.GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof admin.firestore.DocumentReference) {
    return value.path;
  }
  if (Array.isArray(value)) {
    return value.map((v) => toSerializable(v));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toSerializable(v)])
    );
  }

  return value;
}

function serializeCell(value) {
  const normalized = toSerializable(value);
  if (typeof normalized === "string" || typeof normalized === "number" || typeof normalized === "boolean") {
    return normalized;
  }

  if (normalized === null || normalized === undefined) return "";
  return JSON.stringify(normalized);
}

function formatCollectionName(collectionPath) {
  return collectionPath.replace(/\//g, "__");
}

async function exportCollection(collectionRef, options) {
  const collectionPath = collectionRef.path;
  console.log(`Exporting ${collectionPath} ...`);

  const snapshot = await collectionRef.get();
  if (snapshot.empty) {
    console.log(`  (skipped empty collection ${collectionPath})`);
  }

  const docs = snapshot.docs;
  const rows = [];
  const fieldNames = new Set(["__docPath", "__docId"]);

  for (const doc of docs) {
    const data = doc.data() || {};
    Object.keys(data).forEach((key) => fieldNames.add(key));
    rows.push({ doc, data });
  }

  const sortedFields = ["__docPath", "__docId", ...[...fieldNames]
    .filter((key) => key !== "__docPath" && key !== "__docId")
    .sort()];

  const csvLines = [sortedFields.join(",")];
  for (const { doc, data } of rows) {
    const row = sortedFields.map((field) => {
      if (field === "__docPath") return doc.ref.path;
      if (field === "__docId") return doc.id;
      return serializeCell(data[field]);
    });
    csvLines.push(row.map(csvEscape).join(","));
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  const filename = `${formatCollectionName(collectionPath)}.csv`;
  const outputPath = path.join(options.outDir, filename);
  fs.writeFileSync(outputPath, csvLines.join("\n"), "utf8");

  console.log(`  wrote ${rows.length} rows to ${outputPath}`);

  for (const { doc } of rows) {
    // eslint-disable-next-line no-await-in-loop
    const subcollections = await doc.ref.listCollections();
    for (const subcol of subcollections) {
      // eslint-disable-next-line no-await-in-loop
      await exportCollection(subcol, options);
    }
  }
}

async function main() {
  const options = parseArgs();
  fs.mkdirSync(options.outDir, { recursive: true });

  const topCollections = await db.listCollections();
  for (const collection of topCollections) {
    // eslint-disable-next-line no-await-in-loop
    await exportCollection(collection, options);
  }

  console.log("✅ Firestore export completed.");
}

main().catch((err) => {
  console.error("Failed to export Firestore:", err);
  process.exit(1);
});
