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
  setDoc,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase/firebaseConfig";

import { useAuth } from "./hooks/useAuth.jsx";
import { useFcm } from "./hooks/useFcm.jsx";
import AuthPage from "./components/AuthPage";
import TodoCalendar from "./components/TodoCalendar";
import Settings from "./components/Settings";
import BottomNav from "./components/BottomNav";
import AllTasksPage from "./pages/AllTasksPage";
import Analytics from "./pages/Analytics";
import DailyPlan from "./components/DailyPlan";
import ProgressEntry from "./pages/ProgressEntry";
import VersionBadge from "./components/VersionBadge";
import ChangelogModal from "./components/ChangelogModal";
import FeedbackModal from "./components/FeedbackModal";
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
            <li><b>E（Estimate）</b>…タスク完了に必要な見積所要時間（分）。</li>
            <li><b>A(t)</b>…今日までの累積実績時間（分）。タスク行の「実績追加」で記録。</li>
            <li><b>R(t)</b>…残量（分）= max(0, E − A(t))。</li>
            <li><b>必要ペース</b>…R(t) を締切までの残日数で割った値（分/日）。</li>
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
const Layout = ({ logout, loginCount, user }) => {
  const [showChangelog, setShowChangelog] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="container hdr-inner">
          <h1 className="brand">進捗マネジメントアプリ</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn btn-outline"
              style={{ whiteSpace: "nowrap" }}
              onClick={() => setShowFeedback(true)}
            >
              意見を送る
            </button>
            {typeof loginCount === "number" && (
              <span
                title="累計ログイン回数"
                style={{
                  backgroundColor: "#eef2ff",
                  color: "#1e40af",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                ログイン {loginCount}回
              </span>
            )}
            <Link
              to="/help"
              className="btn btn-ghost"
              title="進捗指標の説明"
              aria-label="ヘルプ"
              style={{ fontSize: "18px" }}
            >
              ❓
            </Link>
            <VersionBadge onClick={() => setShowChangelog(true)} />
            <button onClick={logout} className="btn btn-outline">
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <Outlet />
      <BottomNav />
      <FeedbackModal
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        user={user}
      />
      <ChangelogModal open={showChangelog} onClose={() => setShowChangelog(false)} />
    </>
  );
};

const AppWithRouter = ({ logout, user }) => {
  useFcm();
  const [todos, setTodos] = useState([]);
  const [notificationMode, setNotificationMode] = useState("justInTime");
  const [dailyPlans, setDailyPlans] = useState([]);
  const [srcParam, setSrcParam] = useState(null);
  const [loginCount, setLoginCount] = useState(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const initialSrc = searchParams.get("src");
    setSrcParam(initialSrc);
  }, []);

  // ✅ ログイン回数の加算とログ記録
  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const storage = typeof window !== "undefined" ? window.localStorage : null;
    const guardKey = `loginIncGuard:${user.uid}`;
    const now = Date.now();

    if (storage) {
      const lastRaw = storage.getItem(guardKey);
      const last = Number(lastRaw);
      if (Number.isFinite(last) && now - last < 10 * 60 * 1000) {
        return;
      }
    }

    const record = async () => {
      try {
        if (storage) {
          storage.setItem(guardKey, String(now));
        }

        const userRef = doc(db, "users", user.uid);
        await setDoc(
          userRef,
          {
            loginCount: increment(1),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );

        await addDoc(collection(db, "users", user.uid, "logins"), {
          createdAt: serverTimestamp(),
          agent: typeof window !== "undefined" ? window.navigator?.userAgent || "" : "",
          source: "web",
        });
      } catch (error) {
        console.error("failed to record login event", error);
        if (storage) {
          storage.removeItem(guardKey);
        }
      }
    };

    record();
  }, [user?.uid]);

  // ✅ ログイン回数の購読
  useEffect(() => {
    if (!user?.uid) {
      setLoginCount(null);
      return;
    }

    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setLoginCount(null);
        return;
      }

      const value = snap.data()?.loginCount;
      setLoginCount(typeof value === "number" ? value : null);
    });

    return () => unsub();
  }, [user?.uid]);

  // ✅ 通知リンク開封ログを記録する useEffect
  useEffect(() => {
    if (!user || !srcParam) return;
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Tokyo",
    });
    const ref = doc(db, "users", user.uid, "metrics", today);
    setDoc(
      ref,
      {
        [`notifications.opened.${srcParam}`]: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).then(() => console.log(`📬 通知開封ログを記録: ${srcParam}`));
  }, [user, srcParam]);

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
        <Route element={<Layout logout={logout} loginCount={loginCount} user={user} />}>
          {/* ホーム */}
          <Route
            index
            element={
              <main className="app-main">
                <div className="container">
                  <section className="card" style={{ marginBottom: 16 }}>
                    <DailyPlan
                      plans={dailyPlans}
                      todos={todosWithId}
                      onToggleDailyProgress={toggleDailyProgress}
                    />
                  </section>
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
            element={<ProgressEntry todos={todosWithId} src={srcParam} />}
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

          {/* 分析 */}
          <Route path="analytics" element={<Analytics />} />

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

          {/* 旧 /plan へのアクセスはホームへリダイレクト */}
          <Route path="/plan" element={<Navigate to="/" replace />} />

          {/* ヘルプ */}
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
