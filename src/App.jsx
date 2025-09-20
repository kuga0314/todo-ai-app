// src/App.jsx
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  Outlet,
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
import TodoInput from "./components/TodoInput";
import TodoList from "./components/TodoList";
import TodoCalendar from "./components/TodoCalendar";
import Settings from "./components/Settings";
import "./App.css";

function App() {
  const { user, logout } = useAuth();
  if (!user) return <AuthPage />;
  return <AppWithRouter logout={logout} user={user} />;
}
export default App;

/* ===== 共通レイアウト（ヘッダーのみ固定） ===== */
const Layout = ({ logout }) => (
  <>
    <header className="app-header">
      <div className="container hdr-inner">
        <h1 className="brand">ToDoリスト</h1>
        <nav className="app-nav">
          <Link to="/" className="navlink">ホーム</Link>
          <Link to="/settings" className="navlink">設定</Link>
          <button onClick={logout} className="btn btn-outline">ログアウト</button>
        </nav>
      </div>
    </header>
    <Outlet />
  </>
);

/* ===== ルーター本体 ===== */
const AppWithRouter = ({ logout, user }) => {
  useFcm();

  const [todos, setTodos] = useState([]);

  // Firestore の購読（userId でフィルタ）
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

  /**
   * 追加処理を一本化：
   * カレンダーやヘッダー等の “追加” はすべてこの関数を呼ぶ
   * payload 例:
   * {
   *   text: "やること",
   *   deadline: Date,           // 締切（ローカル日時）
   *   estimatedMinutes: 90,     // E（分）
   *   scale: 3,                 // 1..5
   *   priority: 2               // 1..3
   * }
   */
  const addTodo = async (payload) => {
    if (!payload?.text?.trim() || !payload?.deadline) return;

    const toNum = (v, fallback = null) =>
      Number.isFinite(Number(v)) ? Number(v) : fallback;

    const docBody = {
      userId: user.uid, // ← 購読クエリ(where("userId","==", user.uid)) と揃える
      text: payload.text.trim(),
      deadline: Timestamp.fromDate(new Date(payload.deadline)),
      estimatedMinutes: toNum(payload.estimatedMinutes, null),
      scale: toNum(payload.scale, 3),
      priority: toNum(payload.priority, 2),
      completed: false,
      createdAt: Timestamp.now(),
      // startRecommend / explain は Cloud Functions の再計算で付与
    };

    await addDoc(collection(db, "todos"), docBody);
    // onSnapshot で即リスト＆カレンダーに反映／通知計算は Functions 側で実行
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* 共通ヘッダーの下に各ページを差し込む */}
        <Route element={<Layout logout={logout} />}>
          {/* ホーム：従来の2カラム段組みを index ルートに配置 */}
          <Route
            index
            element={
              <main className="app-main">
                <div className="container">
                  <div className="main-grid">
                    <section className="card pane-left">
                      {/* カレンダーに addTodo を渡す */}
                      <TodoCalendar todos={todos} onAdd={addTodo} />
                    </section>

                    <section className="card pane-right">
                      <div className="right-sticky">
                        {/* 既存の入力はそのまま（必要なら TodoInput 側から addTodo を呼ぶ形に統一可） */}
                        <TodoInput />
                      </div>
                      <div className="right-scroll">
                        <TodoList todos={todos} userId={user.uid} />
                      </div>
                    </section>
                  </div>
                </div>
              </main>
            }
          />

          {/* 設定ページ */}
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

          {/* フォールバック */}
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
