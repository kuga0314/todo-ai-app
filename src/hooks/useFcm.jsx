import { useEffect } from "react";
import { arrayUnion, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, messagingPromise } from "../firebase/firebaseConfig";
import { getToken } from "firebase/messaging";
import { useAuth } from "./useAuth";

const VAPID_KEY =
  "BF3fN6efF0iNeI4GAVTKuxPNwFSjcKbsu9nuB0u1RuqMbuhwgQLKf0Lq5ISXSM-WUcHvKdHzoyjEXSjEcEffxdQ";

export const useFcm = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const messaging = await messagingPromise;
        if (!messaging) return;

        // 通知許可
        if (typeof Notification !== "undefined") {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") return;
        }

        // SW登録 → ready を待つ
        let reg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
        if (!reg) await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        reg = await navigator.serviceWorker.ready;

        // トークン取得（SW起動待ちのワンショット再試行つき）
        let token;
        try {
          token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
        } catch (e) {
          if (e?.message?.includes("no active Service Worker")) {
            await new Promise(r => setTimeout(r, 400));
            token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
          } else {
            throw e;
          }
        }
        if (!token) return;

        // Firestoreに保存（変化がある時だけ）※時刻は serverTimestamp()
        const LS = "fcmToken";
        if (localStorage.getItem(LS) !== token) {
          await setDoc(
            doc(db, "users", user.uid),
            { fcmTokens: arrayUnion(token), fcmUpdatedAt: serverTimestamp() },
            { merge: true }
          );
          localStorage.setItem(LS, token);
          console.log("Saved FCM token to Firestore.");
        }
      } catch (e) {
        console.error("FCM setup error:", e);
      }
    })();
  }, [user]);
};
