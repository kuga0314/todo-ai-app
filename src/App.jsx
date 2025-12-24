// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  Link,
  useLocation,
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
import { CalendarCheck, ChatCircleDots, List, Question, SignOut } from "phosphor-react";

import { useAuth } from "./hooks/useAuth.jsx";
import { useFcm } from "./hooks/useFcm.jsx";
import AuthPage from "./components/AuthPage";
import TodoCalendar from "./components/TodoCalendar";
import Settings from "./components/Settings";
import BottomNav from "./components/BottomNav";
import AllTasksPage from "./pages/AllTasksPage";
import AnalyticsPage from "./pages/AnalyticsPage";
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
    <main className="app-main help-page">
      <div className="container">
        <section className="card" style={{ lineHeight: 1.7 }}>
          <h2>このアプリで使う考え方</h2>

          <h3 style={{ marginTop: 16, fontSize: 18 }}>1. 基本の量</h3>
          <ul>
            <li>
              <b>E（Estimate）</b> … タスク完了に必要な<strong>見積所要時間</strong>（分）。
              タスク登録時に一度だけ設定します。
            </li>
            <li>
              <b>A(t)</b> … 今日までの<strong>累積実績時間</strong>（分）。
              日ごとの学習・作業ログにより増えていきます。
            </li>
            <li>
              <b>R(t)</b> … 残量（分） = max(0, E − A(t))。
              まだ必要な作業時間の目安です。
            </li>
            <li>
              <b>必要ペース</b> … R(t) を締切までの残日数で割った値（分/日）。
              「1日あたりどれくらい進めれば間に合うか」を表します。
            </li>
          </ul>

          <h3 style={{ marginTop: 16, fontSize: 18 }}>2. 進捗の指標</h3>
          <ul>
            <li>
              <b>進捗率</b> … A ÷ E。
              1（100%）なら見積どおり、1より大きい場合は見積より速いペースです。
            </li>
            <li>
              <b>SPI（進捗指数）</b> … 過去7日間の<strong>実績ペース</strong> ÷
              <strong>必要ペース</strong>。
              1以上なら計画どおり、1未満なら締切に間に合わない可能性があります。
            </li>
            <li>
              <b>EAC（予測完了日）</b> … 現在のペースが続いた場合にタスクが完了すると予測される日。
              締切を超える日付になる場合は「遅延の可能性が高い」状態です。
            </li>
            <li>
              <b>リスク表示</b> … SPI や EAC に基づき、締切に対する危険度を色とラベルで表示します。
            </li>
            <li>
              <b>赤いビックリマーク</b> … 完了予測日（EAC）が締切よりあとにずれているタスクに表示され、
              締切超過のリスクがあることを示します。
            </li>
          </ul>

          <h3 style={{ marginTop: 16, fontSize: 18 }}>3. 使い方の流れ</h3>
          <ol>
            <li>学習・作業したい内容をタスクとして登録し、E（見積時間）と締切を設定する。</li>
            <li>毎日、その日取り組んだ時間を「実績追加」またはログ編集で記録する。</li>
            <li>「分析」タブで、進捗率・SPI・EAC・日別グラフを確認し現在のペースを把握する。</li>
            <li>必要に応じて今日の目標や進め方を調整し、計画を改善する。</li>
          </ol>

        </section>
      </div>
    </main>
  );
};

/* 共通レイアウト */
const Layout = ({ logout, loginCount, user }) => {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const [slideDirection, setSlideDirection] = useState("forward");

  useEffect(() => {
    const tabOrder = ["/", "/progress", "/all-tasks", "/analytics", "/settings"];
    const prevIndex = tabOrder.indexOf(prevPathRef.current);
    const nextIndex = tabOrder.indexOf(location.pathname);

    if (prevIndex !== -1 && nextIndex !== -1) {
      setSlideDirection(nextIndex >= prevIndex ? "forward" : "backward");
    } else {
      setSlideDirection("forward");
    }

    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  const [showChangelog, setShowChangelog] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="container hdr-inner">
          <h1 className="brand">進捗マネジメントアプリ</h1>
          <div className="hdr-actions hdr-actions--inline">
            <button
              className="hdr-chip hdr-chip--primary"
              onClick={() => setShowFeedback(true)}
            >
              <ChatCircleDots size={18} weight="fill" className="hdr-chip__icon" aria-hidden />
              <span>意見を送る</span>
            </button>
            {typeof loginCount === "number" && (
              <span title="累計ログイン回数" className="hdr-chip hdr-chip--muted">
                <CalendarCheck
                  size={18}
                  weight="bold"
                  className="hdr-chip__icon"
                  aria-hidden
                />
                <span>ログイン {loginCount}回</span>
              </span>
            )}
            <Link
              to="/help"
              className="hdr-chip hdr-chip--ghost"
              title="進捗指標の説明"
              aria-label="ヘルプ"
            >
              <Question size={18} weight="bold" className="hdr-chip__icon" aria-hidden />
              <span>ヘルプ</span>
            </Link>
            <VersionBadge
              onClick={() => setShowChangelog(true)}
              className="hdr-chip hdr-chip--ghost version-badge"
            />
            <button onClick={logout} className="hdr-chip hdr-chip--warn">
              <SignOut size={18} weight="bold" className="hdr-chip__icon" aria-hidden />
              <span>ログアウト</span>
            </button>
          </div>

          <button
            className="hdr-menu-btn"
            aria-label="メニューを開く"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <List size={22} weight="bold" aria-hidden />
          </button>
          {menuOpen && (
            <>
              <div className="hdr-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="hdr-menu">
                <button
                  className="hdr-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowFeedback(true);
                  }}
                >
                  <ChatCircleDots size={18} weight="fill" aria-hidden />
                  <span>意見を送る</span>
                </button>
                <button
                  className="hdr-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowChangelog(true);
                  }}
                >
                  <VersionBadge className="hdr-menu-version" />
                </button>
                <Link
                  to="/help"
                  className="hdr-menu-item"
                  onClick={() => setMenuOpen(false)}
                >
                  <Question size={18} weight="bold" aria-hidden />
                  <span>ヘルプ</span>
                </Link>
                {typeof loginCount === "number" && (
                  <div className="hdr-menu-item hdr-menu-item--muted" role="status">
                    <CalendarCheck size={18} weight="bold" aria-hidden />
                    <span>ログイン {loginCount}回</span>
                  </div>
                )}
                <button
                  className="hdr-menu-item hdr-menu-item--warn"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                >
                  <SignOut size={18} weight="bold" aria-hidden />
                  <span>ログアウト</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="tab-motion-shell">
        <div key={location.pathname} className={`tab-motion slide-${slideDirection}`}>
          <Outlet />
        </div>
      </div>
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

  // 0時での強制ログアウト
  useEffect(() => {
    if (!user?.uid) return;

    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = Math.max(nextMidnight.getTime() - now.getTime(), 0);

    const timerId = setTimeout(() => {
      logout().catch((error) => {
        console.error("auto logout at midnight failed", error);
      });
    }, msUntilMidnight || 1000);

    return () => clearTimeout(timerId);
  }, [logout, user?.uid]);

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
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const visible = rows.filter((t) => t.deleted !== true);
      setTodos(visible);
    });
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

    const plannedStart = payload.plannedStart
      ? Timestamp.fromDate(new Date(payload.plannedStart))
      : null;

    const body = {
      userId: user.uid,
      text: payload.text.trim(),
      deadline: Timestamp.fromDate(new Date(payload.deadline)),
      plannedStart,
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
                  <section className="home-section">
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
          <Route path="analytics" element={<AnalyticsPage />} />

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
