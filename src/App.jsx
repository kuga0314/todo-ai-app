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
import { collection, onSnapshot, query, orderBy, where } from "firebase/firestore";
import { db } from "./firebase/firebaseConfig";

import { useAuth }  from "./hooks/useAuth.jsx";
import { useFcm }   from "./hooks/useFcm.jsx";
import AuthPage     from "./components/AuthPage";
import TodoInput    from "./components/TodoInput";
import TodoList     from "./components/TodoList";
import TodoCalendar from "./components/TodoCalendar";
import Settings     from "./components/Settings";
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

  return (
    <BrowserRouter>
      <Routes>
        {/* 共通ヘッダーの下に各ページを差し込む */}
        <Route element={<Layout logout={logout} />}>
          {/* ホーム：従来の2カラム段組みをそのまま index ルートに配置 */}
          <Route
            index
            element={
              <main className="app-main">
                <div className="container">
                  <div className="main-grid">
                    <section className="card pane-left">
                      <TodoCalendar todos={todos} />
                    </section>

                    <section className="card pane-right">
                      <div className="right-sticky">
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

          {/* 設定：単独ページ表示（ホームの段組みは描画されない） */}
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
