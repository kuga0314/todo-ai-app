// export-csv.js
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
const admin = require("firebase-admin");

const serviceAccount = require("./todoaiapp-5aab8-firebase-adminsdk-fbsvc-d51f110943.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

(async () => {
  console.log("=== Firestore Export Start ===");

  // todos コレクション全件を取得
  const todosSnap = await db.collection("todos").get();
  const rows = [];

  todosSnap.forEach((doc) => {
    const t = doc.data();
    const logs = t.actualLogs || {};

    // 日次ログを展開
    for (const [date, minutes] of Object.entries(logs)) {
      rows.push({
        taskId: doc.id,
        userId: t.userId || t.uid || "",
        text: t.text || "",
        date,
        actualMinutes: minutes,
        estimatedMinutes: t.estimatedMinutes || "",
        deadline: t.deadline?.toDate?.()?.toISOString() || "",
        eacDate: t.eacDate || "",
        completed: !!t.completed,
      });
    }
  });

  // CSVに変換
  const csv = parse(rows);
  const outPath = path.join(__dirname, "todos_export.csv");
  fs.writeFileSync(outPath, csv);
  console.log(`✅ Exported ${rows.length} rows to ${outPath}`);
})();
