import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  ComposedChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { useAuth } from "../hooks/useAuth.jsx";
import LogEditorModal from "../components/LogEditorModal";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import {
  calculateAverages,
  formatMinutes,
  formatProgress,
  parseDateKey,
  resolveRiskDisplay,
  toNumberOrNull,
} from "../utils/analytics";
import { jstDateKey } from "../utils/logUpdates";
import "./Analytics.css";

export default function Analytics() {
  const { user } = useAuth();
  const [refreshTick, setRefreshTick] = useState(0);
  const { loading, noData, todos: rawTodos, labels, dateRange } = useAnalyticsData(
    user?.uid,
    refreshTick
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState([]);
  const [seriesCache, setSeriesCache] = useState({});
  const seriesCacheRef = useRef({});
  const [logEditorState, setLogEditorState] = useState({
    open: false,
    todo: null,
    date: null,
  });
  const [incompleteOnly, setIncompleteOnly] = useState(() => {
    const stored = localStorage.getItem("showIncompleteOnly");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("showIncompleteOnly", String(incompleteOnly));
  }, [incompleteOnly]);

  function handleLogSaved(payload) {
    setRefreshTick((t) => t + 1);
    if (!payload?.todoId) return;
    const next = { ...seriesCacheRef.current };
    delete next[payload.todoId];
    seriesCacheRef.current = next;
    setSeriesCache(next);
  }

  useEffect(() => {
    seriesCacheRef.current = seriesCache;
  }, [seriesCache]);

  const todayKey = useMemo(() => jstDateKey(new Date()), []);
  const latestRangeDate = useMemo(
    () => (dateRange.length ? dateRange[dateRange.length - 1] : todayKey),
    [dateRange, todayKey]
  );

  const openLogEditorForTodo = (todo) => {
    if (!todo) return;
    setLogEditorState({ open: true, todo, date: latestRangeDate });
  };

  const closeLogEditor = () => {
    setLogEditorState({ open: false, todo: null, date: null });
  };

  const labelMap = useMemo(() => {
    const map = new Map();
    labels.forEach((label) => {
      map.set(label.id, label);
    });
    return refreshTick ? new Map(map) : map;
  }, [labels, refreshTick]);

  const baseTodos = useMemo(() => {
    const list = Array.isArray(rawTodos) ? rawTodos : [];
    return incompleteOnly ? list.filter((todo) => !todo?.completed) : list;
  }, [rawTodos, incompleteOnly]);

  const totalSeries = useMemo(() => {
    if (!dateRange.length) return [];
    const totalsMap = new Map(dateRange.map((date) => [date, 0]));

    baseTodos.forEach((todo) => {
      Object.entries(todo.actualLogs || {}).forEach(([key, value]) => {
        if (!totalsMap.has(key)) return;
        const minutes = Number(value);
        if (!Number.isFinite(minutes)) return;
        totalsMap.set(key, (totalsMap.get(key) || 0) + minutes);
      });
    });

    return dateRange.map((date) => ({
      date,
      minutes: totalsMap.get(date) || 0,
    }));
  }, [baseTodos, dateRange]);

  const decoratedTodos = useMemo(() => {
    const result = baseTodos.map((todo) => {
      const estimated = toNumberOrNull(todo.estimatedMinutes);
      const actualTotal = Object.values(todo.actualLogs || {}).reduce(
        (sum, value) => sum + (Number(value) || 0),
        0
      );
      const progressRatio =
        estimated && estimated > 0 ? actualTotal / estimated : null;
      const deadlineAt = todo.deadline?.toDate?.()
        ? todo.deadline.toDate()
        : null;
      const labelInfo = todo.labelId ? labelMap.get(todo.labelId) : null;
      const minutesToday = Number(todo.actualLogs?.[todayKey] || 0);
      const logKeys = Object.keys(todo.actualLogs || {});
      const lastProgressKey = logKeys.length
        ? logKeys.reduce((latest, key) => (latest > key ? latest : key))
        : null;
      const lastProgressAt = lastProgressKey ? parseDateKey(lastProgressKey) : null;
      const lastProgressTime = lastProgressAt?.getTime?.() ?? null;

      return {
        todo,
        actualTotal,
        estimated,
        progressRatio,
        deadlineAt,
        labelInfo,
        minutesToday,
        lastProgressTime,
      };
    });
    return refreshTick ? [...result] : result;
  }, [baseTodos, labelMap, todayKey, refreshTick]);

  const sortedTodos = useMemo(() => {
    if (!decoratedTodos.length) return [];

    const withToday = [];
    const others = [];

    decoratedTodos.forEach((item) => {
      if (item.minutesToday > 0) {
        withToday.push(item);
      } else {
        others.push(item);
      }
    });

    withToday.sort((a, b) => {
      if (b.minutesToday !== a.minutesToday) {
        return b.minutesToday - a.minutesToday;
      }
      return (b.actualTotal || 0) - (a.actualTotal || 0);
    });

    const compareDeadline = (a, b) => {
      const aDeadline = a.deadlineAt ? a.deadlineAt.getTime() : Infinity;
      const bDeadline = b.deadlineAt ? b.deadlineAt.getTime() : Infinity;
      if (aDeadline !== bDeadline) return aDeadline - bDeadline;
      return (b.actualTotal || 0) - (a.actualTotal || 0);
    };

    others.sort((a, b) => {
      const aProgress = a.lastProgressTime;
      const bProgress = b.lastProgressTime;

      if (aProgress && bProgress) {
        if (aProgress !== bProgress) {
          return bProgress - aProgress;
        }
        return compareDeadline(a, b);
      }
      if (aProgress && !bProgress) return -1;
      if (!aProgress && bProgress) return 1;
      return compareDeadline(a, b);
    });

    const combined = [...withToday, ...others];
    return refreshTick ? [...combined] : combined;
  }, [decoratedTodos, refreshTick]);

  const searchLower = searchTerm.trim().toLowerCase();
  const filteredTodos = useMemo(() => {
    const result = sortedTodos.filter(({ todo }) => {
      const title = (todo.text || "").toString().toLowerCase();
      if (searchLower && !title.includes(searchLower)) {
        return false;
      }
      if (labelFilter !== "all") {
        const taskLabelId = todo.labelId ?? null;
        if (taskLabelId !== labelFilter) {
          return false;
        }
      }
      return true;
    });
    return refreshTick ? [...result] : result;
  }, [sortedTodos, searchLower, labelFilter, refreshTick]);

  const buildTaskSeries = useCallback(
    (task) => {
      if (!dateRange.length) return [];
      const logs = task.actualLogs || {};
      let cumulative = 0;
      const estimated = Number(task.estimatedMinutes) || 0;
      let deadline = null;
      const tickMarker = refreshTick;
      if (task.deadline?.toDate) {
        deadline = task.deadline.toDate();
      } else if (task.deadline instanceof Date) {
        deadline = task.deadline;
      } else if (typeof task.deadline === "string" || typeof task.deadline === "number") {
        const parsed = new Date(task.deadline);
        if (!Number.isNaN(parsed.getTime())) {
          deadline = parsed;
        }
      }

      const get7DayPace = (index) => {
        const startIdx = Math.max(0, index - 6);
        let sum = 0;
        let daysWorked = 0;
        for (let i = startIdx; i <= index; i += 1) {
          const key = dateRange[i];
          const value = Number(logs[key]) || 0;
          sum += value;
          if (value > 0) {
            daysWorked += 1;
          }
        }
        const denominator = Math.max(1, daysWorked < 3 ? daysWorked || 1 : 7);
        return sum / denominator;
      };

      return dateRange.map((date, index) => {
        const minutes = Number(logs[date]) || 0;
        const adjustedMinutes = minutes + tickMarker * 0;
        cumulative += adjustedMinutes;

        let spi = null;
        if (deadline) {
          const remaining = Math.max(0, estimated - cumulative);
          const currentDate = parseDateKey(date);
          const msLeft = currentDate ? deadline.getTime() - currentDate.getTime() : 0;
          const daysLeft = Math.max(1, Math.ceil(msLeft / 86400000));
          const required = remaining > 0 ? remaining / daysLeft : 0;
          const pace7 = get7DayPace(index);
          if (required > 0) {
            const raw = pace7 / required;
            spi = Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
          } else {
            spi = remaining === 0 ? 1 : 0;
          }
        }

        return {
          date,
          minutes: adjustedMinutes,
          cum: cumulative,
          spi,
        };
      });
    },
    [dateRange, refreshTick]
  );

  useEffect(() => {
    if (!dateRange.length || !sortedTodos.length) {
      setExpandedIds([]);
      setSeriesCache({});
      return;
    }

    const initial = sortedTodos.slice(0, 5).map(({ todo }) => todo.id);
    const nextCache = {};
    initial.forEach((id) => {
      const task = sortedTodos.find(({ todo }) => todo.id === id);
      if (task) {
        nextCache[id] = buildTaskSeries(task.todo);
      }
    });
    setExpandedIds(initial);
    setSeriesCache(nextCache);
  }, [dateRange, sortedTodos, buildTaskSeries]);

  const ensureSeries = useCallback(
    (task) => {
      setSeriesCache((prev) => {
        if (prev[task.todo.id]) return prev;
        return {
          ...prev,
          [task.todo.id]: buildTaskSeries(task.todo),
        };
      });
    },
    [buildTaskSeries]
  );

  const handleToggle = (task) => {
    ensureSeries(task);
    setExpandedIds((prev) => {
      if (prev.includes(task.todo.id)) {
        return prev.filter((id) => id !== task.todo.id);
      }
      return [...prev, task.todo.id];
    });
  };

  const totalMinutes = useMemo(() => {
    return totalSeries.reduce((sum, item) => sum + (item.minutes || 0), 0) + refreshTick * 0;
  }, [totalSeries, refreshTick]);

  const avg7 = useMemo(
    () => calculateAverages(totalSeries, Math.min(7, totalSeries.length)) + refreshTick * 0,
    [totalSeries, refreshTick]
  );
  const avg30 = useMemo(
    () => calculateAverages(totalSeries, Math.min(30, totalSeries.length)) + refreshTick * 0,
    [totalSeries, refreshTick]
  );

  return (
    <main className="app-main">
      <div className="container ana-layout">
        <section className="card ana-card-section">
          <header className="ana-section-header">
            <h2 className="ana-page-title">📊 分析</h2>
          </header>

          {loading ? (
            <p className="ana-text-muted">読み込み中…</p>
          ) : noData || !dateRange.length ? (
            <p className="ana-text-muted">データがありません</p>
          ) : (
              <div className="ana-content">
                <div className="ana-filters">
                  <input
                    type="search"
                    placeholder="タスク名で検索"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="ana-input"
                  />
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 14,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={incompleteOnly}
                      onChange={(event) => setIncompleteOnly(event.target.checked)}
                    />
                    未完タスクのみ表示
                  </label>
                  {labels.length > 0 && (
                    <select
                      value={labelFilter}
                      onChange={(event) => setLabelFilter(event.target.value)}
                      className="ana-select"
                  >
                    <option value="all">すべてのラベル</option>
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name || label.text || "(無題ラベル)"}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <h3 className="ana-section-title">全タスク合計の作業時間（日別）</h3>
                <div className="ana-metric-row">
                  <div className="ana-metric">
                    <div className="ana-metric__label">累計</div>
                    <div className="ana-metric__value ana-metric__value--large">
                      {formatMinutes(totalMinutes)}
                    </div>
                  </div>
                  <div className="ana-metric">
                    <div className="ana-metric__label">直近7日平均</div>
                    <div className="ana-metric__value">{`${Math.round(avg7)} 分/日`}</div>
                  </div>
                  <div className="ana-metric">
                    <div className="ana-metric__label">直近30日平均</div>
                    <div className="ana-metric__value">{`${Math.round(avg30)} 分/日`}</div>
                  </div>
                </div>
                <div className="ana-chart">
                  <ResponsiveContainer key={`total:${refreshTick}`}>
                    <LineChart
                      key={`total-chart:${refreshTick}`}
                      data={totalSeries}
                      margin={{ left: 16, right: 24, top: 12, bottom: 12 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        angle={-30}
                        textAnchor="end"
                        height={70}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        label={{
                          value: "分",
                          angle: -90,
                          position: "insideLeft",
                          style: { textAnchor: "middle" },
                        }}
                      />
                      <Tooltip formatter={(value) => `${value} 分`} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="minutes"
                        name="日別合計(分)"
                        stroke="#4f46e5"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="ana-task-section">
                <h3 className="ana-section-title ana-section-title--sub">タスク別の実績</h3>
                {filteredTodos.length === 0 ? (
                  <p className="ana-text-muted ana-text-muted--spaced">
                    該当するタスクがありません。
                  </p>
                ) : (
                  filteredTodos.map((task) => {
                    const {
                      todo,
                      estimated,
                      actualTotal,
                      progressRatio,
                      deadlineAt,
                      labelInfo,
                      minutesToday,
                    } = task;
                    const isExpanded = expandedIds.includes(todo.id);
                    const series = seriesCache[todo.id];
                    const displaySeries = series || buildTaskSeries(task.todo);
                    const { riskKey, riskText } = resolveRiskDisplay(
                      todo,
                      displaySeries
                    );
                    const deadlineText = deadlineAt
                      ? format(deadlineAt, "yyyy-MM-dd HH:mm")
                      : "—";
                    const cardRiskKey = riskKey || "none";
                    const todayBadgeClass = `ana-badge ana-badge--today${
                      minutesToday > 0 ? " is-active" : ""
                    }`;
                    return (
                      <div
                        key={todo.id}
                        className={`card ana-card ana-card--risk-${cardRiskKey}`}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleToggle(task)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleToggle(task);
                            }
                          }}
                          className="ana-card__toggle"
                        >
                          <div className="ana-card__head">
                            <div className="ana-card__title" title={todo.text || "(名称未設定)"}>
                              {todo.text || "(名称未設定)"}
                              {labelInfo ? (
                                <span
                                  className="ana-label"
                                  style={
                                    labelInfo.color
                                      ? { "--ana-label-bg": labelInfo.color }
                                      : undefined
                                  }
                                >
                                  {labelInfo.name || labelInfo.text || "ラベル"}
                                </span>
                              ) : null}
                            </div>
                            <div className="ana-head__actions">
                              <span
                                className={`ana-badge ana-badge--risk-${cardRiskKey}`}
                                title="現在のリスク状況"
                              >
                                リスク: {riskText}
                              </span>
                              <span
                                className={todayBadgeClass}
                              >
                                今日 {minutesToday}分
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openLogEditorForTodo(todo);
                                }}
                                className="ana-btn ana-btn--outline"
                              >
                                📝ログ編集
                              </button>
                              <span
                                className={`ana-toggle-icon${isExpanded ? " is-open" : ""}`}
                                aria-hidden="true"
                              >
                                ▶
                              </span>
                            </div>
                          </div>
                          <div className="ana-summary">
                            <div>E: {estimated != null ? formatMinutes(estimated) : "—"}</div>
                            <div>A: {formatMinutes(actualTotal)}</div>
                            <div>進捗率: {formatProgress(progressRatio)}</div>
                            <div>締切: {deadlineText}</div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="ana-card__chart">
                            <div className="ana-chart ana-chart--task">
                              <ResponsiveContainer key={`${todo.id}:${refreshTick}`}>
                                <ComposedChart
                                  key={`${todo.id}:${refreshTick}:chart`}
                                  data={displaySeries}
                                  margin={{ left: 16, right: 24, top: 12, bottom: 12 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  dataKey="date"
                                  tick={{ fontSize: 12 }}
                                  angle={-30}
                                  textAnchor="end"
                                  height={70}
                                  interval="preserveStartEnd"
                                />
                                <YAxis
                                  yAxisId="left"
                                  tick={{ fontSize: 12 }}
                                  label={{
                                    value: "分",
                                    angle: -90,
                                    position: "insideLeft",
                                    style: { textAnchor: "middle" },
                                  }}
                                />
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  tick={{ fontSize: 12 }}
                                  domain={[0, 1.5]}
                                  label={{
                                    value: "SPI",
                                    angle: 90,
                                    position: "insideRight",
                                    style: { textAnchor: "middle" },
                                  }}
                                />
                                <Tooltip
                                  formatter={(value, key) => {
                                    if (key === "minutes") return [`${value} 分`, "日別実績"];
                                    if (key === "cum") return [`${value} 分`, "累積実績"];
                                    if (key === "spi")
                                      return [
                                        Number.isFinite(Number(value))
                                          ? Number(value).toFixed(2)
                                          : value,
                                        "SPI",
                                      ];
                                    return value;
                                  }}
                                />
                                <Legend />
                                <Bar yAxisId="left" dataKey="minutes" name="日別実績(分)" fill="#38bdf8" />
                                <Line
                                  yAxisId="left"
                                  type="monotone"
                                  dataKey="cum"
                                  name="累積実績(分)"
                                  stroke="#f97316"
                                  strokeWidth={2}
                                  dot={false}
                                />
                                <Line
                                  yAxisId="right"
                                  type="monotone"
                                  dataKey="spi"
                                  name="SPI"
                                  stroke="#10b981"
                                  strokeWidth={2}
                                  dot={false}
                                  strokeDasharray="3 3"
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      <LogEditorModal
        open={logEditorState.open}
        onClose={closeLogEditor}
        todo={logEditorState.todo}
        defaultDate={logEditorState.date}
        onSaved={handleLogSaved}
      />
    </main>
  );
}
