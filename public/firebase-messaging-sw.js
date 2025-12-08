/* eslint-env serviceworker */
/* global importScripts, firebase */

// 互換ビルド
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// 公開用Web設定（Consoleの値をそのまま）
firebase.initializeApp({
  apiKey: "AIzaSyCE-EZOIv2FLKf5eZK_rinHXAV5Hks87k",
  authDomain: "todoaiapp-5aab8.firebaseapp.com",
  projectId: "todoaiapp-5aab8",
  storageBucket: "todoaiapp-5aab8.firebasestorage.app",
  messagingSenderId: "317079983804",
  appId: "1:317079983804:web:1e267cc4441da7467e2b9",
});

// 参照保持
const messaging = firebase.messaging();

/** 1) data-only ペイロード対応（将来用） */
messaging.onBackgroundMessage((payload) => {
  // notification ペイロード付きメッセージはブラウザ側で自動表示されるため、
  // Service Worker では通知を重複表示しない。
  if (payload?.notification) return;

  const data = payload?.data || {};
  const title  = data.title || "AI ToDo";
  const body   = data.body  || "お知らせがあります";
  const taskId = data.taskId || null;
  const icon   = data.icon  || "/icons/icon-192.png";
  const badge  = data.badge || "/icons/badge-72.png";
  const url    = data.url   || "/";
  const tag    = data.tag || (taskId ? `todo-${taskId}` : undefined);

  self.registration.showNotification(title, {
    body, icon, badge, tag,
    data: { url, taskId },
    requireInteraction: false,
  });
});

/** 2) 通知クリックで既存タブをフォーカス or 新規オープン */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const targetPath = new URL(url, self.location.origin).pathname; // ← ここがポイント
    for (const client of allClients) {
      if (client.url.includes(targetPath)) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
