// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  Link,
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
import ProgressEntry from "./pages/ProgressEntry"; // ←追加
import "./App.css";

function App() {
  const { user, logout } = useAuth();
  if (!user) return <AuthPage />;
  return <AppWithRouter logout={logout} user={user} />;
}
export default App;

/* ─────────────────────────────
   ヘルプページ
───────────────────────────── */
const HelpPage = () => {
  return (
    <main className="app-main">
      <div className="container">
        <section className="card" style={{ lineHeight: 1.7 }}>
          <h2>このアプリで使う考え方</h2>
          <ul>
            <li>
              <b>E（Estimate）</b>…タスク完了に必要な見積所要時間（分）。
            </li>
            <li>
              <b>A(t)</b>…今日までの累積実績時間（分）。タスク行の「実績追加」で記録。
            </li>
            <li>
              <b>R(t)</b>…残量（分）= max(0, E − A(t))。
            </li>
            <li>
              <b>必要ペース</b>…R(t) を締切までの残日数で割った値（分/日）。
            </li>
          </ul>
          <p style={{ marginTop: 12 }}>
            ※ 研究では O/P/W/重要度は使用しません。E と実績ログから進捗やペースを評価します。
          </p>
        </section>
      </div>
    </main>
  );
};

/* 共通レイアウト */
const Layout = ({ logout }) => (
  <>
    <header className="app-header">
      <div className="container hdr-inner">
        <h1 className="brand">ToDoリスト</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            to="/help"
            className="btn btn-ghost"
            title="進捗指標の説明"
            aria-label="ヘルプ"
            style={{ fontSize: "18px" }}
          >
            ❓
          </Link>
          <button onClick={logout} className="btn btn-outline">
            ログアウト
          </button>
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

  // Firestore購読: todos
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

  // Firestore購読: 通知設定
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid, "settings", "notification");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setNotificationMode("justInTime");
        return;
      }
      const data = snap.data() || {};
      setNotificationMode(
        data?.morningSummaryTime ? "morningSummary" : "off"
      );
    });
    return () => unsub();
  }, [user?.uid]);

  // Firestore購読: dailyPlans
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

  // タスク追加
  const addTodo = async (payload) => {
    if (!payload?.text?.trim() || !payload?.deadline) return;
    const toNum = (v, fb = null) =>
      Number.isFinite(Number(v)) ? Number(v) : fb;

    const body = {
      userId: user.uid,
      text: payload.text.trim(),
      deadline: Timestamp.fromDate(new Date(payload.deadline)),
      estimatedMinutes: toNum(payload.estimatedMinutes, null),
      labelId: payload.labelId || null,
      actualTotalMinutes: 0,
      completed: false,
      createdAt: Timestamp.now(),
      dailyAssignments: [],
      dailyPlanGeneratedAt: null,
      dailyProgress: {},
      assignedMinutes: null,
      unallocatedMinutes: null,
      morningSummaryNotified: false,
      morningSummaryNotifiedAt: null,
      morningSummaryLastDate: null,
    };
    await addDoc(collection(db, "todos"), body);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout logout={logout} />}>
          {/* ホーム */}
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

          {/* 進捗入力 */}
          <Route
            path="progress"
            element={<ProgressEntry todos={todosWithId} />}
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

          {/* プラン一覧 */}
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

          {/* ヘルプ */}
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
