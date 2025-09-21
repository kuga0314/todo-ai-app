import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
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

/* 共通レイアウト（上部はタイトル＋ログアウト、下にBottomNav） */
const Layout = ({ logout }) => (
  <>
    <header className="app-header">
      <div className="container hdr-inner">
        <h1 className="brand">ToDoリスト</h1>
        <div>
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
          {/* ホーム：カレンダーのみ、画面高いっぱい */}
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

          {/* すべてのタスク（縦スクロール） */}
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

          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
