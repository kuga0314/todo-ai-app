/* eslint-env node */

function extractFcmTokens(data = {}) {
  const tokens = new Set();
  if (Array.isArray(data.fcmTokens)) {
    data.fcmTokens
      .filter((token) => typeof token === "string" && token.trim() !== "")
      .forEach((token) => tokens.add(token));
  }
  if (typeof data.fcmToken === "string" && data.fcmToken.trim() !== "") {
    tokens.add(data.fcmToken);
  }
  return Array.from(tokens);
}

function isInvalidFcmTokenError(error) {
  const code = error?.code;
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

async function removeFcmToken({ db, FieldValue, uid, token, removeLegacy }) {
  if (!db || !FieldValue || !uid || !token) return;
  const updates = {
    fcmTokens: FieldValue.arrayRemove(token),
  };
  if (removeLegacy) {
    updates.fcmToken = FieldValue.delete();
  }
  try {
    await db.doc(`users/${uid}`).set(updates, { merge: true });
  } catch (error) {
    console.error("failed to remove invalid FCM token", { uid, token, error });
  }
}

module.exports = { extractFcmTokens, isInvalidFcmTokenError, removeFcmToken };
