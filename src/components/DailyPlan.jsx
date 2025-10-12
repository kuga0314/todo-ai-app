// src/components/DailyPlan.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  updateDoc,
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

/** “遅れベース＋キャパ連動”で今日のプランを選定 */
function selectTodayPlan(todos, appSettings) {
  const capDefault = 120;
  const cap = Number.isFinite(Number(appSettings?.dailyCap))
    ? Number(appSettings.dailyCap)
    : capDefault;

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
    const need = Math.min(Math.max(0, c.required), c.R, cap - used);
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

export default function DailyPlan() {
  const { user } = useAuth();
  const [todos, setTodos] = useState([]);
  const [appSettings, setAppSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const dateKey = useMemo(() => todayKeyTokyo(), []);

  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      setLoading(true);
      // todos
      const snap = await getDocs(
        query(collection(db, "todos"), where("userId", "==", user.uid))
      );
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTodos(list);

      // app settings（dailyCap 等）
      const appSnap = await getDoc(doc(db, `users/${user.uid}/settings/app`));
      setAppSettings(appSnap.exists() ? appSnap.data() : null);

      setLoading(false);
    })();
  }, [user?.uid]);

  const plan = useMemo(() => selectTodayPlan(todos, appSettings), [todos, appSettings]);

  const { chartData, totals: chartTotals } = useMemo(() => {
    const rows = (todos || [])
      .map((t) => {
        const assigned = Number(t?.assigned?.[dateKey]) || 0;
        const actual = Number(t?.actualLogs?.[dateKey]) || 0;
        if (assigned <= 0 && actual <= 0) return null;
        return {
          id: t.id,
          name: t.text || "（無題）",
          planned: Math.round(assigned),
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
  }, [todos, dateKey]);

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

  /** ★ 今日の割当を Firestore に書き込み */
  useEffect(() => {
    if (!user?.uid || !plan?.items?.length) return;
    (async () => {
      const ops = plan.items.map((item) => {
        const ref = doc(db, "todos", item.id);
        return updateDoc(ref, {
          [`assigned.${dateKey}`]: item.todayMinutes,
        });
      });
      await Promise.allSettled(ops);
      console.log("✅ 今日の割当を todos.assigned に保存しました:", dateKey);
    })();
  }, [user?.uid, plan, dateKey]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <h3 style={{ margin: 0 }}>今日のプラン</h3>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{dateKey}</div>
      </div>

      <div className="card-content">
        {loading ? (
          <div>読み込み中…</div>
        ) : (
          <>
            {!plan.items || plan.items.length === 0 ? (
              <div>今日は予定された日次プランがありません。</div>
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>
                  合計 <b>{plan.used}</b> 分
                  {Number.isFinite(plan.cap) && (
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>
                      （上限 {plan.cap} 分）
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
                  {plan.items.map((it, idx) => (
                    <li
                      key={it.id}
                      style={{
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
                      <BarChart data={chartDataWithSummary}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
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
    </div>
  );
}
