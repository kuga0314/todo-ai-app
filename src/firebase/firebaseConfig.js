// src/firebase/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCE-EZOIv2FLKf5FeZK_rinHXAV5Hks87k",
  authDomain: "todoaiapp-5aab8.firebaseapp.com",
  projectId: "todoaiapp-5aab8",
  storageBucket: "todoaiapp-5aab8.firebasestorage.app",
  messagingSenderId: "317079983804",
  appId: "1:317079983804:web:1e267cc4441da7467e2b9",
};

export const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);

// （将来の通知用）ブラウザ対応時だけ Messaging を使う
export const messagingPromise = isSupported().then(ok => (ok ? getMessaging(app) : null));
