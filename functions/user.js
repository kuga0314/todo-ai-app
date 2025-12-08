/* eslint-env node */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

exports.user = functions
  .region("asia-northeast1")
  .https.onRequest((req, res) =>
    cors(req, res, async () => {
      if (req.method !== "GET") {
        res.status(405).json({ error: "method-not-allowed" });
        return;
      }

      const uid = req.path.replace(/^\//, "") || req.query.uid;
      if (!uid) {
        res.status(400).json({ error: "uid-required" });
        return;
      }

      try {
        const userRef = db.doc(`users/${uid}`);
        const settingsRef = db.doc(`users/${uid}/settings/app`);

        const [userSnap, settingsSnap] = await Promise.all([
          userRef.get(),
          settingsRef.get(),
        ]);

        res.status(200).json({
          id: uid,
          exists: userSnap.exists,
          user: userSnap.exists ? userSnap.data() : {},
          settings: settingsSnap.exists ? settingsSnap.data() : {},
        });
      } catch (error) {
        console.error("getUser failed", { uid, error });
        res.status(500).json({ error: "getUser-failed" });
      }
    })
  );
