/* eslint-env node */

function extractFcmTokens(data = {}) {
  const tokens = new Set();
  const fromArray = Array.isArray(data.fcmTokens)
    ? data.fcmTokens.filter((token) => typeof token === "string" && token.trim() !== "")
    : [];

  // 旧フィールド fcmToken が残っていても、配列が存在する場合は配列を優先して
  // 同一デバイスへの二重送信を避ける。
  if (fromArray.length > 0) {
    fromArray.forEach((token) => tokens.add(token));
  } else if (typeof data.fcmToken === "string" && data.fcmToken.trim() !== "") {
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
