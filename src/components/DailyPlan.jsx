// src/components/DailyPlan.jsx
import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
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
import { fetchDailyPlansInRange, fetchTodos } from "../repositories/dailyPlanRepo";
import "./DailyPlan.css";

function PastPlansModal({
  open,
  onClose,
  monthValue,
  onMonthChange,
  data,
  selectedDate,
  onSelectDate,
  loading,
  error,
}) {
  if (!open) return null;

  const hasData = data && data.length > 0;
  const selectedRow = hasData ? data.find((row) => row.dateKey === selectedDate) : null;
  const chartRows = selectedRow?.chartRows ?? [];

  return (
    <div className="daily-plan-history-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="daily-plan-history-modal"
        onClick={(e) => e.stopPropagation()}
        aria-label="過去のプラン"
      >
        <div className="daily-plan-history-header">
          <div>
            <div className="daily-plan-history-title">過去のプランを見る</div>
            <div className="daily-plan-history-subtitle">
              月を選んで、提案されたプランと実績を比較できます。
            </div>
          </div>
          <button type="button" className="daily-plan-history-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="daily-plan-history-controls">
          <label className="daily-plan-history-label" htmlFor="history-month">
            表示する月
          </label>
          <input
            id="history-month"
            type="month"
            value={monthValue}
            onChange={(e) => onMonthChange(e.target.value)}
            className="daily-plan-history-month"
          />
        </div>

        {hasData && (
          <div className="daily-plan-history-controls">
            <label className="daily-plan-history-label" htmlFor="history-day">
              表示する日
            </label>
            <select
              id="history-day"
              value={selectedDate ?? ""}
              onChange={(e) => onSelectDate(e.target.value)}
              className="daily-plan-history-day"
            >
              {data.map((row) => (
                <option key={row.dateKey} value={row.dateKey}>
                  {row.dateKey}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="daily-plan-history-error">{error}</div>}

        {loading ? (
          <div className="daily-plan-history-loading">読み込み中…</div>
        ) : hasData && selectedRow ? (
          <div className="daily-plan-history-chart">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartRows} margin={{ bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                  tick={{ fontSize: 11 }}
                />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="planned" name="Planned" fill="var(--chart-planned)">
                  {chartRows.map((entry) => (
                    <Cell
                      key={`${entry.id}-planned`}
                      fill={
                        entry.isSummary
                          ? "var(--chart-planned)"
                          : entry.color || "var(--chart-planned)"
                      }
                      fillOpacity={entry.isSummary ? 0.7 : 0.4}
                      stroke={
                        entry.isSummary
                          ? "var(--chart-planned)"
                          : entry.color || "var(--chart-planned)"
                      }
                      strokeOpacity={entry.isSummary ? 0.9 : 0.6}
                    />
                  ))}
                </Bar>
                <Bar dataKey="actual" name="Actual" fill="var(--chart-actual)">
                  {chartRows.map((entry) => (
                    <Cell
                      key={`${entry.id}-actual`}
                      fill={
                        entry.isSummary
                          ? "var(--chart-actual)"
                          : entry.color || "var(--chart-actual)"
                      }
                      fillOpacity={entry.isSummary ? 0.95 : 0.9}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : hasData ? (
          <div className="daily-plan-history-empty">日付を選択してください。</div>
        ) : (
          <div className="daily-plan-history-empty">
            この月には表示できるプランがありません。
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySelectedDate, setHistorySelectedDate] = useState("");

  useEffect(() => {
    if (!historyOpen || !user?.uid) return;

    const makeRange = (value) => {
      const [y, m] = value.split("-").map((v) => Number(v));
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
      const startKey = `${y}-${String(m).padStart(2, "0")}-01`;
      const endDate = new Date(y, m, 0);
      const endKey = `${y}-${String(m).padStart(2, "0")}-${String(endDate.getDate()).padStart(
        2,
        "0"
      )}`;
      return { startKey, endKey };
    };

    const range = makeRange(historyMonth);
    if (!range) {
      setHistoryError("月の形式が正しくありません");
      setHistoryData([]);
      return;
    }

    let canceled = false;
    setHistoryLoading(true);
    setHistoryError("");

    (async () => {
      try {
        const [plans, todos] = await Promise.all([
          fetchDailyPlansInRange({
            db,
            uid: user.uid,
            startKey: range.startKey,
            endKey: range.endKey,
          }),
          fetchTodos({ db, uid: user.uid }),
        ]);

        const todoMap = new Map(
          (todos || []).map((t) => [
            t.id,
            {
              ...t,
              actualLogs: t.actualLogs || {},
            },
          ])
        );

        const fallbackColors = [
          "#6c5ce7",
          "#00b894",
          "#0984e3",
          "#e17055",
          "#fdcb6e",
          "#00cec9",
          "#f39c12",
        ];

        const rows = (plans || [])
          .map((plan) => {
            const dateKey = plan.date || plan.id || "";
            if (!dateKey) return null;
            const items =
              Array.isArray(plan?.lastChange?.after?.items) && plan.lastChange?.after?.items.length > 0
                ? plan.lastChange.after.items
                : Array.isArray(plan.items)
                  ? plan.items
                  : [];
            let colorCursor = 0;

            const tasks = items
              .map((item) => {
                const todoId = item?.todoId || item?.id;
                if (!todoId) return null;
                const todo = todoMap.get(todoId);
                const plannedValue = item?.plannedMinutes ?? item?.todayMinutes ?? item?.requiredMinutes;
                const planned = Math.max(0, Math.round(Number(plannedValue) || 0));
                const actual = todo
                  ? Math.max(0, Math.round(Number(todo.actualLogs?.[dateKey]) || 0))
                  : 0;
                const shouldInclude = planned > 0 || actual > 0;
                if (!shouldInclude) return null;
                const color =
                  item?.labelColor || todo?.labelColor || fallbackColors[colorCursor % fallbackColors.length];
                colorCursor += 1;
                return {
                  id: todoId,
                  name: item?.title || item?.text || todo?.text || "（無題）",
                  planned,
                  actual,
                  color,
                };
              })
              .filter(Boolean);

            if (tasks.length === 0) return null;

            const plannedTotal = tasks.reduce((sum, t) => sum + (Number(t.planned) || 0), 0);
            const actualTotal = tasks.reduce((sum, t) => sum + (Number(t.actual) || 0), 0);

            const chartRows = [
              ...tasks,
              {
                id: "__summary__",
                name: "合計",
                planned: plannedTotal,
                actual: actualTotal,
                color: "#9aa0a6",
                isSummary: true,
              },
            ];

            return {
              dateKey,
              label: dateKey.slice(5),
              chartRows,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

        if (!canceled) {
          setHistoryData(rows);
          setHistoryError("");
          setHistorySelectedDate((prev) => {
            if (rows.some((row) => row.dateKey === prev)) return prev;
            return rows[0]?.dateKey || "";
          });
        }
      } catch (error) {
        console.error("failed to load plan history", error);
        if (!canceled) {
          setHistoryError("履歴の読み込みに失敗しました。時間をおいて再度お試しください。");
          setHistoryData([]);
          setHistorySelectedDate("");
        }
      } finally {
        if (!canceled) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [historyOpen, historyMonth, user?.uid, db]);

  const effectiveActualForRate =
    Number.isFinite(chartTotals?.effectiveActual) && chartTotals.effectiveActual > 0
      ? chartTotals.effectiveActual
      : 0;
  const completionRate =
    chartTotals?.planned > 0
      ? Math.min(100, Math.round((effectiveActualForRate / chartTotals.planned) * 100))
      : 0;
  const progressRadius = 36;
  const progressCircumference = 2 * Math.PI * progressRadius;
  const progressSegments = useMemo(() => {
    if (!chartTotals?.planned || chartTotals.planned <= 0) return [];
    const total = chartTotals.planned;
    let accumulated = 0;
    return chartData
      .filter((row) => row.effectiveActual > 0)
      .map((row) => {
        const fraction = Math.min(Math.max(row.effectiveActual / total, 0), 1);
        const start = accumulated;
        accumulated += fraction;
        const arcLength = fraction * progressCircumference;
        const gapLength = Math.max(progressCircumference - arcLength, 0);
        return {
          id: row.id,
          color: row.color || "#5c55b6",
          dasharray: `${arcLength} ${gapLength}`,
          dashoffset: progressCircumference * (1 - start),
          name: row.name,
          minutes: row.effectiveActual,
        };
      });
  }, [chartData, chartTotals?.planned, progressCircumference]);
  const legendRows = useMemo(
    () => chartData.filter((row) => row.effectiveActual > 0),
    [chartData]
  );
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
    <div className="card card--spaced daily-plan-card">
      <div className="card-header daily-plan-header">
        <div>
          <h3 className="daily-plan-title-heading">今日のプラン</h3>
          <div className="daily-plan-date">{todayKey}</div>
        </div>
        <div className="daily-plan-actions">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="daily-plan-btn daily-plan-btn--ghost"
          >
            過去のプランを見る
          </button>
          <button
            type="button"
            onClick={handleRefreshPlan}
            className="daily-plan-btn"
          >
            今日のプランを更新
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="daily-plan-btn"
          >
            {collapsed ? "表示 ▼" : "非表示 ▲"}
          </button>
        </div>
      </div>

      {refreshMessage && (
        <div className="daily-plan-refresh">
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
                          {progressSegments.map((segment) => (
                            <circle
                              key={segment.id}
                              className="daily-plan-meter-segment"
                              cx="48"
                              cy="48"
                              r={progressRadius}
                              stroke={segment.color}
                              strokeDasharray={segment.dasharray}
                              style={{ strokeDashoffset: segment.dashoffset }}
                            />
                          ))}
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
                        {chartTotals.actual !== chartTotals.effectiveActual && (
                          <div className="daily-plan-meter-sub daily-plan-meter-sub--note">
                            達成率計算上の実績:{" "}
                            <strong>{chartTotals.effectiveActual}</strong> 分（各タスクの目安を上限に集計）
                          </div>
                        )}
                        {legendRows.length > 0 && (
                          <div className="daily-plan-meter-legend" aria-label="タスク別の実績内訳">
                            {legendRows.map((row) => (
                              <span className="daily-plan-meter-legend-item" key={row.id}>
                                <span
                                  className="daily-plan-meter-legend-swatch"
                                  style={{ background: row.color || "#5c55b6" }}
                                  aria-hidden="true"
                                />
                                <span className="daily-plan-meter-legend-label">
                                  {row.name}（{row.effectiveActual} 分）
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
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
                            style={{ "--item-index": idx }}
                          >
                            <div className="plan-left">
                              <span
                                className="plan-dot"
                                style={{
                                  background: it.labelColor || "transparent",
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
                            <h4 className="daily-plan-chart-title">Planned vs Actual</h4>
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
                              <Bar dataKey="planned" name="Planned" fill="var(--chart-planned)">
                                {chartDataWithSummary.map((entry) => (
                                  <Cell
                                    key={`${entry.id}-planned`}
                                    fill={
                                      entry.isSummary
                                        ? "var(--chart-planned)"
                                        : entry.color || "var(--chart-planned)"
                                    }
                                    fillOpacity={entry.isSummary ? 0.7 : 0.4}
                                    stroke={
                                      entry.isSummary
                                        ? "var(--chart-planned)"
                                        : entry.color || "var(--chart-planned)"
                                    }
                                    strokeOpacity={entry.isSummary ? 0.9 : 0.6}
                                  />
                                ))}
                              </Bar>
                              <Bar dataKey="actual" name="Actual" fill="var(--chart-actual)">
                                {chartDataWithSummary.map((entry) => (
                                  <Cell
                                    key={`${entry.id}-actual`}
                                    fill={
                                      entry.isSummary
                                        ? "var(--chart-actual)"
                                        : entry.color || "var(--chart-actual)"
                                    }
                                    fillOpacity={entry.isSummary ? 0.95 : 0.9}
                                  />
                                ))}
                              </Bar>
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

      <PastPlansModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        monthValue={historyMonth}
        onMonthChange={setHistoryMonth}
        data={historyData}
        selectedDate={historySelectedDate}
        onSelectDate={setHistorySelectedDate}
        loading={historyLoading}
        error={historyError}
      />
    </div>
  );
}
