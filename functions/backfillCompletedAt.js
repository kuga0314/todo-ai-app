/* eslint-env node */
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function backfillCompletedAt() {
  const snapshot = await db
    .collection("todos")
    .where("completed", "==", true)
    .get();

  let processed = 0;
  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const docSnap of snapshot.docs) {
    processed += 1;
    const data = docSnap.data() || {};
    if (data.completedAt) continue;

    const completedAtValue = data.createdAt
      ? data.createdAt
      : admin.firestore.FieldValue.serverTimestamp();

    batch.update(docSnap.ref, { completedAt: completedAtValue });
    batchCount += 1;
    updated += 1;

    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      console.log(`Committed 400 updates so far (processed: ${processed}).`);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(
    `Backfill completed. Processed: ${processed}, updated: ${updated}.`
  );
}

if (require.main === module) {
  backfillCompletedAt()
    .then(() => {
      console.log("✅ Backfill completedAt migration finished.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Backfill failed", err);
      process.exit(1);
    });
}

module.exports = { backfillCompletedAt };
