// src/App.jsx
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  Link,              // ★ 追加：ヘッダの「？」リンクで使用
} from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  addDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase/firebaseConfig";

import { useAuth } from "./hooks/useAuth.jsx";
import { useFcm } from "./hooks/useFcm.jsx";
import AuthPage from "./components/AuthPage";
import TodoCalendar from "./components/TodoCalendar";
import Settings from "./components/Settings";
import BottomNav from "./components/BottomNav";
import AllTasksPage from "./pages/AllTasksPage";
import "./App.css";

function App() {
  const { user, logout } = useAuth();
  if (!user) return <AuthPage />;
  return <AppWithRouter logout={logout} user={user} />;
}
export default App;

/* ─────────────────────────────
   ヘルプ（簡易版）
   後で src/components/Help.jsx に分離可
───────────────────────────── */
const HelpPage = () => {
  return (
    <main className="app-main">
      <div className="container">
        <section className="card" style={{ lineHeight: 1.7 }}>
          <h2>O / M / P / w について</h2>
          <ul>
            <li><b>O（Optimistic）</b>…最も順調なときの所要（分）</li>
            <li><b>M（Most likely）</b>…最もありそうな所要（分）</li>
            <li><b>P（Pessimistic）</b>…最も時間がかかる想定（分）</li>
            <li>
              <b>w</b>…修正版PERTにおける M の重み（大きいほど M を重視）。
              期待値は <code>TE<sub>w</sub> = (O + w·M + P) / (w + 2)</code>
            </li>
          </ul>
          <p style={{ marginTop: 12 }}>
            ※ 本アプリでは「優先度」という語は使わず<strong>「重要度」</strong>表記に統一します。
            重要度は見分け（表示・フィルタ）用で、通知時刻の計算には影響しません。
          </p>
        </section>
      </div>
    </main>
  );
};

/* 共通レイアウト（上部はタイトル＋ログアウト＋ヘルプ、下にBottomNav） */
const Layout = ({ logout }) => (
  <>
    <header className="app-header">
      <div className="container hdr-inner">
        <h1 className="brand">ToDoリスト</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* ★ 追加：ヘルプ導線（ログアウトの隣に「？」） */}
          <Link
            to="/help"
            className="btn btn-ghost"
            title="O/M/P と w の説明"
            aria-label="ヘルプ"
            style={{ fontSize: "18px" }}
          >
            ❓
          </Link>
          <button onClick={logout} className="btn btn-outline">ログアウト</button>
        </div>
      </div>
    </header>

    <Outlet />

    <BottomNav />
  </>
);

const AppWithRouter = ({ logout, user }) => {
  useFcm();
  const [todos, setTodos] = useState([]);

  // Firestore購読（ユーザーごと）
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "todos"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) =>
      setTodos(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => unsub();
  }, [user?.uid]);

  // 追加（必要に応じてTodoCalendarから呼ぶ）
  const addTodo = async (payload) => {
    if (!payload?.text?.trim() || !payload?.deadline) return;
    const toNum = (v, fb = null) => (Number.isFinite(Number(v)) ? Number(v) : fb);
    const body = {
      userId: user.uid,
      text: payload.text.trim(),
      deadline: Timestamp.fromDate(new Date(payload.deadline)),
      estimatedMinutes: toNum(payload.estimatedMinutes, null),
      // DBのキーは当面そのまま（UI上の呼称のみ変更：規模/不確実性→w、優先度→重要度）
      scale: toNum(payload.scale, 3),
      priority: toNum(payload.priority, 2),
      completed: false,
      createdAt: Timestamp.now(),
    };
    await addDoc(collection(db, "todos"), body);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout logout={logout} />}>
          {/* ホーム：カレンダー */}
          <Route
            index
            element={
              <main className="app-main">
                <div className="container">
                  <section className="home-cal">
                    <TodoCalendar todos={todos} onAdd={addTodo} />
                  </section>
                </div>
              </main>
            }
          />

          {/* すべてのタスク */}
          <Route path="all-tasks" element={<AllTasksPage todos={todos} />} />

          {/* 設定 */}
          <Route
            path="settings"
            element={
              <main className="app-main">
                <div className="container">
                  <section className="card">
                    <Settings />
                  </section>
                </div>
              </main>
            }
          />

          {/* ★ 追加：/help */}
          <Route path="help" element={<HelpPage />} />

          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
