// src/App.jsx
import { useEffect, useMemo, useState } from "react";
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
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase/firebaseConfig";

import { useAuth } from "./hooks/useAuth.jsx";
import { useFcm } from "./hooks/useFcm.jsx";
import AuthPage from "./components/AuthPage";
import TodoCalendar from "./components/TodoCalendar";
import Settings from "./components/Settings";
import BottomNav from "./components/BottomNav";
import AllTasksPage from "./pages/AllTasksPage";
import DailyPlan from "./components/DailyPlan";
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
  const [notificationMode, setNotificationMode] = useState("justInTime");
  const [dailyPlans, setDailyPlans] = useState([]);

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

  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid, "settings", "notification");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setNotificationMode("justInTime");
        return;
      }
      const data = snap.data() || {};
      setNotificationMode(data.mode === "morningSummary" ? "morningSummary" : "justInTime");
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const colRef = collection(db, "users", user.uid, "dailyPlans");
    const qPlans = query(colRef, orderBy("date", "asc"));
    const unsub = onSnapshot(qPlans, (snap) => {
      const rows = [];
      snap.forEach((docSnap) => {
        rows.push({ id: docSnap.id, ...(docSnap.data() ?? {}) });
      });
      setDailyPlans(rows);
    });
    return () => unsub();
  }, [user?.uid]);

  const todosWithId = useMemo(() => todos ?? [], [todos]);

  const toggleDailyProgress = async (todoId, dateKey, checked) => {
    if (!todoId || !dateKey) return;
    try {
      await updateDoc(doc(db, "todos", todoId), {
        [`dailyProgress.${dateKey}`]: checked,
      });
    } catch (error) {
      console.error("update daily progress failed", error);
    }
  };

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
                  {notificationMode === "morningSummary" && (
                    <section className="card" style={{ marginBottom: 16 }}>
                      <DailyPlan
                        plans={dailyPlans}
                        todos={todosWithId}
                        onToggleDailyProgress={toggleDailyProgress}
                      />
                    </section>
                  )}
                  <section className="home-cal">
                    <TodoCalendar
                      todos={todosWithId}
                      onAdd={addTodo}
                      notificationMode={notificationMode}
                    />
                  </section>
                </div>
              </main>
            }
          />

          {/* すべてのタスク */}
          <Route
            path="all-tasks"
            element={
              <AllTasksPage
                todos={todosWithId}
                notificationMode={notificationMode}
                onToggleDailyProgress={toggleDailyProgress}
              />
            }
          />

          <Route
            path="plan"
            element={
              <main className="app-main">
                <div className="container">
                  <section className="card" style={{ padding: "20px" }}>
                    <DailyPlan
                      plans={dailyPlans}
                      todos={todosWithId}
                      onToggleDailyProgress={toggleDailyProgress}
                      headline="日次プラン一覧"
                      showUpcoming
                    />
                  </section>
                </div>
              </main>
            }
          />

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
