// src/components/DailyPlan.jsx
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/** JSTのYYYY-MM-DD */
function todayKeyTokyo() {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

function getTodayKey() {
  return todayKeyTokyo();
}

/** “遅れベース＋キャパ連動”で今日のプランを選定 */
function selectTodayPlan(todos, appSettings, _todayKey, options = {}) {
  const { mode = "initial", remainingCap = null } = options;
  const capDefault = 120;
  const baseCap = Number.isFinite(Number(appSettings?.dailyCap))
    ? Number(appSettings.dailyCap)
    : capDefault;

  let cap;
  if (mode === "initial") {
    cap = baseCap;
  } else {
    if (typeof remainingCap === "number" && remainingCap > 0) {
      cap = remainingCap;
    } else {
      cap = Infinity;
    }
  }

  const today = new Date();

  // 候補抽出：遅れているタスク（actual < ideal）
  const candidates = [];
  for (const t of todos) {
    const E = Number(t.estimatedMinutes) || 0;
    const A = Number(t.actualTotalMinutes) || 0;
    if (E <= 0 || A >= E) continue;

    const R = Math.max(0, E - A);
    const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;

    // 期限・開始日時
    const deadline =
      t.deadline?.toDate?.() ??
      (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
    if (!deadline) continue;

    const createdAt =
      t.createdAt?.toDate?.() ??
      (t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : null) ??
      today;

    // 理想進捗 vs 実進捗
    const totalDays = Math.max(1, Math.ceil((deadline - createdAt) / 86400000));
    const elapsed = Math.max(0, Math.ceil((today - createdAt) / 86400000));
    const ideal = Math.min(1, elapsed / totalDays);
    const actual = Math.min(1, A / E);
    const lag = ideal - actual; // 正なら遅れ

    if (lag <= 0) continue;

    candidates.push({
      id: t.id,
      text: t.text || "（無題）",
      R,
      required,
      lag,
      deadlineTs: deadline.getTime(),
      labelColor: t.labelColor,
    });
  }

  // 並べ替え：遅れ度 → 必要ペース → 締切近さ
  candidates.sort(
    (a, b) =>
      b.lag - a.lag ||
      b.required - a.required ||
      a.deadlineTs - b.deadlineTs
  );

  // キャパで詰める（最大3件）
  let used = 0;
  const plan = [];
  for (const c of candidates) {
    let need;

    const required = Math.max(0, c.required);
    const R = c.R;

    if (cap === Infinity) {
      need = Math.min(required, R);
    } else {
      const remainCapForThisTask = Math.max(0, cap - used);
      need = Math.min(required, R, remainCapForThisTask);
    }
    if (need <= 0) continue;
    plan.push({ ...c, todayMinutes: Math.round(need) });
    used += need;
    if (used >= cap || plan.length >= 3) break;
  }

  // fallback：遅れ候補ゼロなら、締切＋必要ペースで上位3件
  if (plan.length === 0) {
    const pending = todos
      .map((t) => {
        const E = Number(t.estimatedMinutes) || 0;
        const A = Number(t.actualTotalMinutes) || 0;
        if (E <= 0 || A >= E) return null;
        const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;
        const deadline =
          t.deadline?.toDate?.() ??
          (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
        if (!deadline) return null;
        return {
          id: t.id,
          text: t.text || "（無題）",
          required,
          deadlineTs: deadline.getTime(),
          labelColor: t.labelColor,
        };
      })
      .filter(Boolean);
    pending.sort((a, b) => a.deadlineTs - b.deadlineTs || b.required - a.required);
    return {
      items: pending
        .slice(0, 3)
        .map((x) => ({ ...x, todayMinutes: Math.round(x.required) })),
      cap,
      used: Math.round(
        pending.slice(0, 3).reduce((s, x) => s + x.required, 0)
      ),
    };
  }

  return { items: plan, cap, used: Math.round(used) };
}

function mapPlanItemsForDailyPlan(items = []) {
  return items.map((item, index) => {
    const required = Number.isFinite(Number(item.required))
      ? Math.round(Number(item.required))
      : null;

    return {
      todoId: item.id,
      title: item.text || "（無題）",
      plannedMinutes: Math.max(0, Math.round(Number(item.todayMinutes) || 0)),
      order: index + 1,
      requiredMinutes: required,
      labelColor: item.labelColor || null,
    };
  });
}

function normalizePlanResult(result) {
  const items = (result?.items || []).map((item, index) => ({
    id: item.id,
    text: item.text || "（無題）",
    todayMinutes: Math.max(0, Math.round(Number(item.todayMinutes) || 0)),
    labelColor: item.labelColor || null,
    required: Number.isFinite(Number(item.required))
      ? Math.round(Number(item.required))
      : undefined,
    order: index + 1,
  }));

  const usedFromItems = Math.round(
    items.reduce((sum, item) => sum + (Number(item.todayMinutes) || 0), 0)
  );
  const used = Number.isFinite(Number(result?.used))
    ? Math.round(Number(result.used))
    : usedFromItems;

  return {
    cap: Number.isFinite(Number(result?.cap)) ? Math.round(Number(result.cap)) : null,
    used,
    items,
  };
}

function normalizePlanDocument(data) {
  const items = (data?.items || []).map((item, index) => ({
    id: item.todoId,
    text: item.title || "（無題）",
    todayMinutes: Math.max(0, Math.round(Number(item.plannedMinutes) || 0)),
    labelColor: item.labelColor || null,
    order: Number.isFinite(Number(item.order)) ? Math.round(item.order) : index + 1,
  }));

  const used = Number.isFinite(Number(data?.totalPlannedMinutes))
    ? Math.round(Number(data.totalPlannedMinutes))
    : Math.round(items.reduce((sum, item) => sum + (Number(item.todayMinutes) || 0), 0));

  return {
    cap: Number.isFinite(Number(data?.capMinutes))
      ? Math.round(Number(data.capMinutes))
      : null,
    used,
    items,
  };
}

function planSnapshotForHistory(plan) {
  if (!plan) return null;
  return {
    capMinutes: plan.cap,
    totalPlannedMinutes: plan.used,
    items: mapPlanItemsForDailyPlan(plan.items),
  };
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefined(v))
      .filter((v) => v !== undefined);
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.entries(value).reduce((acc, [key, val]) => {
      const cleaned = removeUndefined(val);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {});
  }

  return value === undefined ? undefined : value;
}

export default function DailyPlan({ todos: propTodos = [] }) {
  const { user } = useAuth();
  const [todos, setTodos] = useState(() =>
    (propTodos || []).filter((t) => t.deleted !== true)
  );
  const [appSettings, setAppSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [planState, setPlanState] = useState(null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [revealWave, setRevealWave] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dailyPlan.collapsed") === "true";
  });
  const todayKey = useMemo(() => getTodayKey(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("dailyPlan.collapsed", collapsed ? "true" : "false");
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed) {
      setRevealWave((v) => v + 1);
    }
  }, [collapsed]);

  useEffect(() => {
    const visible = (propTodos || []).filter((t) => t.deleted !== true);
    setTodos(visible);
  }, [propTodos]);

  useEffect(() => {
    if (!user?.uid) {
      setAppSettings(null);
      setLoading(false);
      setPlanLoaded(true);
      setPlanState(null);
      return;
    }

    let canceled = false;
    setLoading(true);

    (async () => {
      try {
        const appSnap = await getDoc(doc(db, `users/${user.uid}/settings/app`));
        if (!canceled) {
          setAppSettings(appSnap.exists() ? appSnap.data() : null);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    })();

    let planCanceled = false;
    setPlanLoaded(false);
    (async () => {
      try {
        const planSnap = await getDoc(doc(db, "users", user.uid, "dailyPlans", todayKey));
        if (!planCanceled) {
          if (planSnap.exists()) {
            setPlanState(normalizePlanDocument(planSnap.data()));
          } else {
            setPlanState(null);
          }
          setPlanLoaded(true);
        }
      } catch (error) {
        console.error("failed to load daily plan", error);
        if (!planCanceled) {
          setPlanState(null);
          setPlanLoaded(true);
        }
      }
    })();

    return () => {
      canceled = true;
      planCanceled = true;
    };
  }, [todayKey, user?.uid]);

  const incompleteTodos = useMemo(
    () => (todos || []).filter((t) => !t.completed),
    [todos]
  );

  const initialPlanCandidate = useMemo(
    () => selectTodayPlan(incompleteTodos, appSettings, todayKey, { mode: "initial" }),
    [incompleteTodos, appSettings, todayKey]
  );

  const activePlan = planState || normalizePlanResult(initialPlanCandidate);

  const planTodayMinutesMap = useMemo(() => {
    const map = new Map();
    (activePlan?.items || []).forEach((item) => {
      const minutes = Number(item.todayMinutes) || 0;
      if (minutes > 0) {
        map.set(item.id, Math.round(minutes));
      }
    });
    return map;
  }, [activePlan?.items]);

  const { chartData, totals: chartTotals } = useMemo(() => {
    const rows = (incompleteTodos || [])
      .map((t) => {
        const assigned = Number(t?.assigned?.[todayKey]) || 0;
        const fallbackAssigned = planTodayMinutesMap.get(t.id) || 0;
        const plannedMinutes = assigned > 0 ? assigned : fallbackAssigned;
        const actual = Number(t?.actualLogs?.[todayKey]) || 0;
        if (plannedMinutes <= 0 && actual <= 0) return null;
        return {
          id: t.id,
          name: t.text || "（無題）",
          planned: Math.round(plannedMinutes),
          actual: Math.round(actual),
        };
      })
      .filter(Boolean);

    const plannedTotal = Math.round(
      rows.reduce((sum, row) => sum + (Number(row.planned) || 0), 0)
    );
    const actualTotal = Math.round(
      rows.reduce((sum, row) => sum + (Number(row.actual) || 0), 0)
    );

    return {
      chartData: rows,
      totals: {
        planned: plannedTotal,
        actual: actualTotal,
        hasData: rows.length > 0,
      },
    };
  }, [incompleteTodos, todayKey, planTodayMinutesMap]);

  const chartDataWithSummary = useMemo(() => {
    if (!chartTotals.hasData) return [];
    return [
      ...chartData,
      {
        id: "__summary__",
        name: "合計",
        planned: chartTotals.planned,
        actual: chartTotals.actual,
        isSummary: true,
      },
    ];
  }, [chartData, chartTotals]);

  useEffect(() => {
    if (!user?.uid || !planLoaded) return;
    if (planState) return;
    if (!incompleteTodos || incompleteTodos.length === 0) return;

    const nextPlan = normalizePlanResult(initialPlanCandidate);
    setPlanState(nextPlan);

    (async () => {
      try {
        const planRef = doc(db, "users", user.uid, "dailyPlans", todayKey);
        const payload = {
          date: todayKey,
          userId: user.uid,
          capMinutes: Number.isFinite(Number(nextPlan.cap))
            ? Math.round(Number(nextPlan.cap))
            : null,
          totalPlannedMinutes: Math.max(0, Math.round(Number(nextPlan.used) || 0)),
          items: mapPlanItemsForDailyPlan(nextPlan.items || []),
          source: "dailyPlan-app",
          updatedAt: serverTimestamp(),
        };
        await setDoc(planRef, payload, { merge: true });
        await Promise.allSettled(
          nextPlan.items.map((item) => {
            const todo = incompleteTodos.find((t) => t.id === item.id);
            if (!todo) return null;
            const ref = doc(db, "todos", item.id);
            const newAssigned = {
              ...(todo.assigned || {}),
              [todayKey]: item.todayMinutes,
            };
            return updateDoc(ref, { assigned: newAssigned });
          })
        );
      } catch (error) {
        console.error("failed to initialize daily plan", error);
      }
    })();
  }, [user?.uid, planLoaded, planState, initialPlanCandidate, todayKey, incompleteTodos]);

  const savePlanWithHistory = async (nextPlan, { previousPlan } = {}) => {
    if (!user?.uid) return;

    const planRef = doc(db, "users", user.uid, "dailyPlans", todayKey);
    const payload = {
      date: todayKey,
      userId: user.uid,
      capMinutes: Number.isFinite(Number(nextPlan.cap)) ? nextPlan.cap : null,
      totalPlannedMinutes: Math.max(0, Math.round(Number(nextPlan.used) || 0)),
      items: mapPlanItemsForDailyPlan(nextPlan.items || []),
      source: "dailyPlan-app",
      updatedAt: serverTimestamp(),
    };

    const historyPayload = previousPlan
      ? {
          userId: user.uid,
          before: planSnapshotForHistory(previousPlan),
          after: planSnapshotForHistory(nextPlan),
          source: "dailyPlan-app",
          changedAt: serverTimestamp(),
        }
      : null;

    const safePayload = removeUndefined(payload);
    const safeHistory = historyPayload ? removeUndefined(historyPayload) : null;

    if (safeHistory) {
      await Promise.all([
        setDoc(planRef, { ...safePayload, lastChange: safeHistory }, { merge: true }),
        addDoc(collection(planRef, "revisions"), safeHistory),
      ]);
    } else {
      await setDoc(planRef, safePayload, { merge: true });
    }

    await Promise.allSettled(
      (nextPlan.items || []).map((item) => {
        const todo = incompleteTodos.find((t) => t.id === item.id);
        if (!todo) return null;
        const ref = doc(db, "todos", item.id);
        const newAssigned = {
          ...(todo.assigned || {}),
          [todayKey]: item.todayMinutes,
        };
        return updateDoc(ref, { assigned: newAssigned });
      })
    );

    setPlanState(nextPlan);
  };

  const arePlansEqual = (a, b) => {
    if (!a || !b) return false;
    if (Number(a.cap) !== Number(b.cap)) return false;
    if (Number(a.used) !== Number(b.used)) return false;
    const ai = a.items || [];
    const bi = b.items || [];
    if (ai.length !== bi.length) return false;
    for (let i = 0; i < ai.length; i++) {
      const x = ai[i];
      const y = bi[i];
      if (
        x.id !== y.id ||
        Number(x.todayMinutes) !== Number(y.todayMinutes) ||
        Number(x.order) !== Number(y.order)
      ) {
        return false;
      }
    }
    return true;
  };

  const handleRefreshPlan = async () => {
    if (!user?.uid) return;
    const ok =
      typeof window !== "undefined"
        ? window.confirm("今日のプランを更新しますか？")
        : true;
    if (!ok) return;

    try {
      const freshSnap = await getDocs(
        query(collection(db, "todos"), where("userId", "==", user.uid))
      );
      const freshTodos = freshSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .filter((t) => t.deleted !== true);
      setTodos(freshTodos);

      const freshIncomplete = freshTodos.filter((t) => !t.completed);
      const nextPlan = normalizePlanResult(
        selectTodayPlan(freshIncomplete, appSettings, todayKey, {
          mode: "initial",
        })
      );

      if (planState && arePlansEqual(planState, nextPlan)) {
        setRefreshMessage(
          "進捗に変化がないため、提案内容に変更はありません。"
        );
        return;
      }

      await savePlanWithHistory(nextPlan, { previousPlan: planState });
      setRefreshMessage(
        "入力済みの進捗を反映して、今日のプランを再計算しました。"
      );
      setRevealWave((v) => v + 1);
    } catch (error) {
      console.error("refresh daily plan failed", error);
      const isPermissionError =
        error?.code === "permission-denied" ||
        /permission/i.test(error?.message || "");
      setRefreshMessage(
        isPermissionError
          ? "権限エラーのため今日のプランを保存できませんでした。再ログインするか、管理者に権限設定をご確認ください。"
          : "今日のプランの更新に失敗しました。時間をおいて再度お試しください。"
      );
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        className="card-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>今日のプラン</h3>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{todayKey}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleRefreshPlan}
            style={{
              background: "#fff",
              border: "1px solid #d0d0d0",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            今日のプランを更新
          </button>
          <button
            type="button"
            onClick={() =>
              setCollapsed((prev) => {
                return !prev;
              })
            }
            style={{
              background: "#fff",
              border: "1px solid #d0d0d0",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {collapsed ? "表示 ▼" : "非表示 ▲"}
          </button>
        </div>
      </div>

      {refreshMessage && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "#f5f7ff",
            border: "1px solid #d9e2ff",
            color: "#2d3a8c",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {refreshMessage}
        </div>
      )}

      {!collapsed && (
        <div
          key={revealWave}
          className="card-content daily-plan-content"
          data-wave={revealWave}
        >
          {loading || !planLoaded ? (
            <div>読み込み中…</div>
          ) : (
            <>
              {!activePlan.items || activePlan.items.length === 0 ? (
              <div>今日は予定された日次プランがありません。</div>
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>
                  合計 <b>{activePlan.used}</b> 分
                  {Number.isFinite(activePlan.cap) && (
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>
                      （上限 {activePlan.cap} 分）
                    </span>
                  )}
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                  }}
                >
                    {activePlan.items.map((it, idx) => (
                      <li
                        key={it.id}
                        className="daily-plan-item"
                        style={{
                          "--item-index": idx,
                          display: "flex",
                          alignItems: "center",
                          padding: "6px 0",
                          borderTop:
                            idx === 0 ? "none" : "1px solid rgba(0,0,0,0.06)",
                        }}
                      >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: it.labelColor || "transparent",
                          display: "inline-block",
                          marginRight: 8,
                          border: "1px solid rgba(0,0,0,0.1)",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {idx + 1}. {it.text}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          目安 {it.todayMinutes} 分
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div style={{ marginTop: 24 }}>
              <h4 style={{ margin: "16px 0 8px" }}>Planned vs Actual</h4>
              {!chartTotals.hasData ? (
                <p style={{ color: "#666", fontSize: 13 }}>
                  今日の割当と実績データはまだありません。
                </p>
              ) : (
                <>
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartDataWithSummary} margin={{ bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="name"
                          interval={0}
                          angle={-30}
                          textAnchor="end"
                          height={60}
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="planned" name="Planned" fill="#8884d8" />
                        <Bar dataKey="actual" name="Actual" fill="#82ca9d" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <table
                    style={{
                      width: "100%",
                      marginTop: 12,
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={{ padding: "6px 4px" }}>タスク</th>
                        <th style={{ padding: "6px 4px", textAlign: "right" }}>
                          予定 (分)
                        </th>
                        <th style={{ padding: "6px 4px", textAlign: "right" }}>
                          実績 (分)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((row) => (
                        <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                          <td style={{ padding: "6px 4px" }}>{row.name}</td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>
                            {row.planned}
                          </td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>
                            {row.actual}
                          </td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "2px solid #ccc", fontWeight: 600 }}>
                        <td style={{ padding: "6px 4px" }}>合計</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>
                          {chartTotals.planned}
                        </td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>
                          {chartTotals.actual}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
