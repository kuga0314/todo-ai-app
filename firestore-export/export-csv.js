// export-csv.js
// Firestore → CSVエクスポート（tasks.csv と daily_progress.csv を出力）
// UTF-8 with BOM ＋ カンマ区切り（Excel完全対応）

const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
const admin = require("firebase-admin");

// ===== Firebase初期化 =====
const serviceAccount = require("./todoaiapp-5aab8-firebase-adminsdk-fbsvc-d51f110943.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ===== 実行関数 =====
(async () => {
  console.log("=== Firestore Export Start ===");

  // todos コレクション全件取得
  const todosSnap = await db.collection("todos").get();

  const dailyRows = []; // 日次実績
  const taskRows = [];  // タスク台帳

  todosSnap.forEach((doc) => {
    const t = doc.data() || {};
    const logs = t.actualLogs || {};

    // ---- タスク台帳（全タスク1行）----
    taskRows.push({
      taskId: doc.id,
      userId: t.userId || t.uid || "",
      text: t.text || "",
      createdAt: t.createdAt?.toDate?.()?.toISOString() || "",
      deadline: t.deadline?.toDate?.()?.toISOString() || "",
      eacDate: t.eacDate || "",
      estimatedMinutes: Number(t.estimatedMinutes ?? 0),
      actualTotalMinutes: Number(t.actualTotalMinutes ?? 0),
      completed: !!t.completed,
      labelId: t.labelId || "",
      priority: t.priority ?? "",
    });

    // ---- 日次実績（actualLogsに記録がある日だけ）----
    for (const [date, minutes] of Object.entries(logs)) {
      dailyRows.push({
        taskId: doc.id,
        userId: t.userId || t.uid || "",
        text: t.text || "",
        date, // YYYY-MM-DD
        actualMinutes: Number(minutes ?? 0),
        estimatedMinutes: Number(t.estimatedMinutes ?? 0),
        deadline: t.deadline?.toDate?.()?.toISOString() || "",
        eacDate: t.eacDate || "",
        completed: !!t.completed,
      });
    }
  });

  // ===== CSV出力（UTF-8 BOM付き・カンマ区切り） =====
  const outDir = path.resolve(__dirname);
  const csvOpts = { withBOM: true }; // Excelが自動でUTF-8判定＆列分割OK

  const csvTasks = parse(taskRows, csvOpts);
  const csvDaily = parse(dailyRows, csvOpts);

  fs.writeFileSync(path.join(outDir, "tasks.csv"), csvTasks, "utf8");
  fs.writeFileSync(path.join(outDir, "daily_progress.csv"), csvDaily, "utf8");

  console.log(`✅ tasks.csv: ${taskRows.length} rows`);
  console.log(`✅ daily_progress.csv: ${dailyRows.length} rows`);
  console.log("=== Export Complete ===");
})();
