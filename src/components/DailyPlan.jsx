// src/components/DailyPlan.jsx
import { useMemo, useState } from "react";
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
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "../hooks/useAuth";
import { db } from "../firebase/firebaseConfig";
import { useDailyPlan } from "../hooks/useDailyPlan";
import { isEacOverDeadline } from "../utils/calendarHelpers";
import { flagAnalyticsAttention } from "../utils/analyticsAlert";

export default function DailyPlan({ todos: propTodos = [], plans: propPlans = [] }) {
  const { user } = useAuth();
  const {
    todayKey,
    loading,
    planLoaded,
    activePlan,
    refreshMessage,
    collapsed,
    toggleCollapsed,
    handleRefreshPlan,
    revealWave,
    chartData,
    chartTotals,
    chartDataWithSummary,
  } = useDailyPlan({ propTodos, propPlans, user, db });
  const [inputs, setInputs] = useState({});
  const [saving, setSaving] = useState(false);
  const completionRate =
    chartTotals?.planned > 0
      ? Math.min(100, Math.round((chartTotals.actual / chartTotals.planned) * 100))
      : 0;
  const progressRadius = 36;
  const progressCircumference = 2 * Math.PI * progressRadius;
  const todoMap = useMemo(() => {
    const map = new Map();
    propTodos.forEach((todo) => {
      if (todo?.id) {
        map.set(todo.id, todo);
      }
    });
    return map;
  }, [propTodos]);

  const totalEntered = useMemo(
    () =>
      Object.values(inputs).reduce((acc, v) => {
        const n = Math.round(Number(v));
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [inputs]
  );

  const handleChange = (id, v) => {
    setInputs((m) => ({ ...m, [id]: v }));
  };

  const saveAllInline = async () => {
    if (saving) return;
    const targets = activePlan?.items
      ?.map((it) => {
        const minutes = Math.round(Number(inputs[it.id]));
        const todo = todoMap.get(it.id);
        return {
          todo,
          minutes,
        };
      })
      .filter((t) => t.todo && Number.isFinite(t.minutes) && t.minutes > 0);

    if (!targets || targets.length === 0) return;

    setSaving(true);
    try {
      await Promise.all(
        targets.map(async ({ todo, minutes }) => {
          const currentTotal = Number.isFinite(Number(todo?.actualTotalMinutes))
            ? Number(todo.actualTotalMinutes)
            : 0;
          const oldValue = Math.max(
            0,
            Math.round(Number(todo?.actualLogs?.[todayKey]) || 0)
          );
          const delta = minutes - oldValue;
          await updateDoc(doc(db, "todos", todo.id), {
            actualTotalMinutes: currentTotal + delta,
            [`actualLogs.${todayKey}`]: minutes,
            lastProgressAt: serverTimestamp(),
          });
          await addDoc(collection(db, "todos", todo.id, "sessions"), {
            date: todayKey,
            minutes: delta,
            source: "daily-plan-inline",
            trigger: "daily-plan-inline",
            createdAt: serverTimestamp(),
          });
        })
      );
      flagAnalyticsAttention();
      setInputs({});
      alert("保存しました！");
    } catch (e) {
      console.error("inline save failed", e);
      alert("保存に失敗しました。通信状況をご確認ください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header daily-plan-header">
        <div>
          <h3 style={{ margin: 0 }}>今日のプラン</h3>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{todayKey}</div>
        </div>
        <div className="daily-plan-actions">
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
            onClick={toggleCollapsed}
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
                <div className="daily-plan-grid">
                  <div className="daily-plan-summary">
                    <div className="daily-plan-total">
                      合計 <b>{activePlan.used}</b> 分
                      {Number.isFinite(activePlan.cap) && (
                        <span className="daily-plan-cap">（上限 {activePlan.cap} 分）</span>
                      )}
                    </div>

                    <div className="daily-plan-progress">
                      <div className="daily-plan-meter" aria-label={`実績達成率 ${completionRate}%`}>
                        <svg viewBox="0 0 96 96" className="daily-plan-meter-graph">
                          <circle
                            className="daily-plan-meter-track"
                            cx="48"
                            cy="48"
                            r={progressRadius}
                            strokeDasharray={progressCircumference}
                          />
                          <circle
                            className="daily-plan-meter-value"
                            cx="48"
                            cy="48"
                            r={progressRadius}
                            strokeDasharray={progressCircumference}
                            style={{
                              strokeDashoffset:
                                progressCircumference * (1 - completionRate / 100),
                            }}
                          />
                        </svg>
                        <div className="daily-plan-meter-center">
                          <span className="daily-plan-meter-percent">{completionRate}%</span>
                          <span className="daily-plan-meter-label">達成</span>
                        </div>
                      </div>
                      <div className="daily-plan-meter-caption">
                        <div className="daily-plan-meter-title">Plannedに対する実績</div>
                        <div className="daily-plan-meter-sub">
                          予定 <strong>{chartTotals.planned}</strong> 分 / 実績{" "}
                          <strong>{chartTotals.actual}</strong> 分
                        </div>
                      </div>
                    </div>

                    <ul className="daily-plan-list">
                      {activePlan.items.map((it, idx) => {
                        const todo = todoMap.get(it.id);
                        const shouldWarn = todo && !todo.completed && isEacOverDeadline(todo);
                        const actualToday = Math.max(
                          0,
                          Math.round(Number(todo?.actualLogs?.[todayKey]) || 0)
                        );

                        return (
                          <li
                            key={it.id}
                            className="daily-plan-item plan-row"
                            style={{
                              "--item-index": idx,
                              borderTop:
                                idx === 0 ? "none" : "1px solid rgba(0,0,0,0.06)",
                            }}
                          >
                            <div className="plan-left">
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: "50%",
                                  background: it.labelColor || "transparent",
                                  display: "inline-block",
                                  border: "1px solid rgba(0,0,0,0.1)",
                                }}
                              />
                              {shouldWarn ? (
                                <span
                                  className="plan-warn-badge"
                                  aria-label="完了予測日が締切以降です"
                                  title="完了予測日が締切以降です"
                                >
                                  !
                                </span>
                              ) : (
                                <span
                                  className="plan-warn-badge plan-warn-badge--placeholder"
                                  aria-hidden="true"
                                >
                                  !
                                </span>
                              )}
                            </div>
                            <div className="plan-body">
                              <div className="plan-title-row">
                                <div className="plan-title">
                                  {idx + 1}. {it.text}
                                </div>
                                {actualToday > 0 ? (
                                  <div className="plan-log-input plan-log-input--readonly">
                                    <span className="plan-log-input__label">今日の実績</span>
                                    <span className="plan-log-input__value">{actualToday} 分</span>
                                  </div>
                                ) : (
                                  <label className="plan-log-input">
                                    <span className="plan-log-input__label">今日の実績</span>
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      placeholder="例: 30"
                                      value={inputs[it.id] ?? ""}
                                      onChange={(e) => handleChange(it.id, e.target.value)}
                                    />
                                    <span className="plan-log-input__suffix">分</span>
                                  </label>
                                )}
                              </div>
                              <div className="plan-meta">目安 {it.todayMinutes} 分</div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="daily-plan-save-row">
                      <div className="daily-plan-save-meta">
                        今日の入力合計: <b>{totalEntered}</b> 分
                      </div>
                      <button
                        type="button"
                        className="plan-save-btn"
                        onClick={saveAllInline}
                        disabled={saving || totalEntered <= 0}
                      >
                        {saving ? "保存中…" : "一括保存"}
                      </button>
                    </div>
                  </div>

                  <div className="daily-plan-analytics">
                    <div className="daily-plan-chart-card">
                      <div className="daily-plan-chart-header">
                        <h4 style={{ margin: 0 }}>Planned vs Actual</h4>
                        {chartTotals.hasData && (
                          <div className="daily-plan-chart-pills">
                            <span className="daily-plan-pill daily-plan-pill--planned">
                              予定 <strong>{chartTotals.planned}</strong> 分
                            </span>
                            <span className="daily-plan-pill daily-plan-pill--actual">
                              実績 <strong>{chartTotals.actual}</strong> 分
                            </span>
                          </div>
                        )}
                      </div>

                      {!chartTotals.hasData ? (
                        <p className="daily-plan-chart-empty">
                          今日の割当と実績データはまだありません。
                        </p>
                      ) : (
                        <div className="daily-plan-chart">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartDataWithSummary} margin={{ bottom: 36 }}>
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
                      )}
                    </div>

                    {chartTotals.hasData && (
                      <div className="daily-plan-table-wrapper">
                        <table className="daily-plan-table">
                          <thead>
                            <tr>
                              <th>タスク</th>
                              <th>予定 (分)</th>
                              <th>実績 (分)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {chartData.map((row) => (
                              <tr key={row.id}>
                                <td>{row.name}</td>
                                <td>{row.planned}</td>
                                <td>{row.actual}</td>
                              </tr>
                            ))}
                            <tr className="daily-plan-table-total">
                              <td>合計</td>
                              <td>{chartTotals.planned}</td>
                              <td>{chartTotals.actual}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
