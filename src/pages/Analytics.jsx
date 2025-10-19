import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
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
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth.jsx";

const DATE_CAP = 365;

const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseDateKey = (key) => {
  const [y, m, d] = key.split("-").map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(y, m - 1, d);
};

const buildDateRange = (startKey, endKey) => {
  const startDate = parseDateKey(startKey);
  const endDate = parseDateKey(endKey);
  if (!startDate || !endDate) return [];

  const diffDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
  if (diffDays >= DATE_CAP) {
    startDate.setDate(endDate.getDate() - (DATE_CAP - 1));
  }

  const keys = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    keys.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

const sanitizeLogs = (logs) => {
  const result = {};
  if (!logs || typeof logs !== "object") return result;
  Object.entries(logs).forEach(([key, value]) => {
    const minutes = Number(value);
    if (Number.isFinite(minutes)) {
      result[key] = minutes;
    }
  });
  return result;
};

const toNumberOrNull = (value) => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatMinutes = (minutes) => `${minutes} 分`;

const formatProgress = (ratio) => {
  if (!Number.isFinite(ratio)) return "—";
  return `${Math.round(Math.max(0, ratio) * 100)}%`;
};

const resolveRiskDisplay = (todo, series) => {
  const normalizeRisk = (value) => {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (["ok", "warn", "late"].includes(trimmed)) return trimmed;
    // allow legacy labels such as Japanese strings
    if (trimmed === "良好") return "ok";
    if (trimmed === "注意") return "warn";
    if (trimmed === "遅延" || trimmed === "危険" || trimmed === "警戒") return "late";
    return null;
  };

  const risk = normalizeRisk(todo.riskLevel);

  let fallback = null;
  if (!risk) {
    const lastPoint = Array.isArray(series) && series.length ? series[series.length - 1] : null;
    const spi = Number(lastPoint?.spi);
    if (Number.isFinite(spi)) {
      if (spi >= 1) fallback = "ok";
      else if (spi >= 0.85) fallback = "warn";
      else fallback = "late";
    }
  }

  const effective = risk ?? fallback ?? null;

  const riskText =
    effective === "late"
      ? "🔴 遅延"
      : effective === "warn"
      ? "🟡 注意"
      : effective === "ok"
      ? "🟢 良好"
      : "—";

  const riskBorderColor =
    effective === "late"
      ? "#ef4444"
      : effective === "warn"
      ? "#f59e0b"
      : effective === "ok"
      ? "#10b981"
      : "#cbd5e1";

  const badgeColors = (() => {
    if (effective === "late") return { bg: "#fee2e2", fg: "#991b1b", bd: "#fca5a5" };
    if (effective === "warn") return { bg: "#fef9c3", fg: "#854d0e", bd: "#fde68a" };
    if (effective === "ok") return { bg: "#dcfce7", fg: "#065f46", bd: "#86efac" };
    return { bg: "#e2e8f0", fg: "#334155", bd: "#cbd5e1" };
  })();

  return { riskKey: effective, riskText, badgeColors, riskBorderColor };
};

const calculateAverages = (series, windowSize) => {
  if (!series.length) return 0;
  const recent = series.slice(-windowSize);
  const total = recent.reduce((sum, item) => sum + (item.minutes || 0), 0);
  return total / recent.length;
};

export default function Analytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [todos, setTodos] = useState([]);
  const [labels, setLabels] = useState([]);
  const [dateRange, setDateRange] = useState([]);
  const [totalSeries, setTotalSeries] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState([]);
  const [seriesCache, setSeriesCache] = useState({});

  const todayKey = useMemo(
    () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    []
  );

  useEffect(() => {
    if (!user?.uid) return;

    let active = true;
    const load = async () => {
      setLoading(true);
      setNoData(false);
      try {
        const todosQuery = query(
          collection(db, "todos"),
          where("userId", "==", user.uid)
        );
        const labelsQuery = collection(db, "users", user.uid, "labels");

        const [todoSnap, labelSnap] = await Promise.all([
          getDocs(todosQuery),
          getDocs(labelsQuery),
        ]);

        if (!active) return;

        const fetchedLabels = labelSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() || {}),
        }));

        const fetchedTodos = [];
        const allDates = new Set();
        todoSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const actualLogs = sanitizeLogs(data.actualLogs);
          Object.keys(actualLogs).forEach((key) => allDates.add(key));
          fetchedTodos.push({
            id: docSnap.id,
            ...data,
            actualLogs,
          });
        });

        if (allDates.size === 0) {
          setTodos(fetchedTodos);
          setLabels(fetchedLabels);
          setDateRange([]);
          setTotalSeries([]);
          setNoData(true);
          return;
        }

        const sortedDates = Array.from(allDates).sort();
        const minKey = sortedDates[0];
        const maxActualKey = sortedDates[sortedDates.length - 1];
        const todayKey = new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Tokyo",
        });
        const maxKey = todayKey > maxActualKey ? todayKey : maxActualKey;
        const range = buildDateRange(minKey, maxKey);

        const totalsMap = new Map(range.map((key) => [key, 0]));
        fetchedTodos.forEach((todo) => {
          Object.entries(todo.actualLogs || {}).forEach(([key, value]) => {
            if (!totalsMap.has(key)) return;
            const minutes = Number(value);
            if (!Number.isFinite(minutes)) return;
            totalsMap.set(key, totalsMap.get(key) + minutes);
          });
        });

        setTodos(fetchedTodos);
        setLabels(fetchedLabels);
        setDateRange(range);
        setTotalSeries(
          range.map((date) => ({
            date,
            minutes: totalsMap.get(date) || 0,
          }))
        );
      } catch (error) {
        console.warn("Failed to load analytics data", error);
        if (!active) return;
        setTodos([]);
        setLabels([]);
        setDateRange([]);
        setTotalSeries([]);
        setNoData(true);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  const labelMap = useMemo(() => {
    const map = new Map();
    labels.forEach((label) => {
      map.set(label.id, label);
    });
    return map;
  }, [labels]);

  const decoratedTodos = useMemo(() => {
    return todos.map((todo) => {
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
  }, [todos, labelMap, todayKey]);

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

    return [...withToday, ...others];
  }, [decoratedTodos]);

  const searchLower = searchTerm.trim().toLowerCase();
  const filteredTodos = useMemo(() => {
    return sortedTodos.filter(({ todo }) => {
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
  }, [sortedTodos, searchLower, labelFilter]);

  const buildTaskSeries = useCallback(
    (task) => {
      if (!dateRange.length) return [];
      const logs = task.actualLogs || {};
      let cumulative = 0;
      const estimated = Number(task.estimatedMinutes) || 0;
      let deadline = null;
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
        cumulative += minutes;

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
          minutes,
          cum: cumulative,
          spi,
        };
      });
    },
    [dateRange]
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
    return totalSeries.reduce((sum, item) => sum + (item.minutes || 0), 0);
  }, [totalSeries]);

  const avg7 = useMemo(() => calculateAverages(totalSeries, Math.min(7, totalSeries.length)), [totalSeries]);
  const avg30 = useMemo(() => calculateAverages(totalSeries, Math.min(30, totalSeries.length)), [totalSeries]);

  return (
    <main className="app-main">
      <div className="container" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="card" style={{ padding: 16 }}>
          <header style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>📊 分析</h2>
          </header>

          {loading ? (
            <p style={{ color: "#666" }}>読み込み中…</p>
          ) : noData || !dateRange.length ? (
            <p style={{ color: "#666" }}>データがありません</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <input
                  type="search"
                  placeholder="タスク名で検索"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  style={{
                    flex: "1 1 220px",
                    minWidth: 200,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                  }}
                />
                {labels.length > 0 && (
                  <select
                    value={labelFilter}
                    onChange={(event) => setLabelFilter(event.target.value)}
                    style={{
                      flex: "0 0 auto",
                      minWidth: 180,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                    }}
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
                <h3 style={{ marginBottom: 12, fontSize: 18 }}>全タスク合計の作業時間（日別）</h3>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>累計</div>
                    <div style={{ fontSize: 20, fontWeight: 600 }}>{formatMinutes(totalMinutes)}</div>
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>直近7日平均</div>
                    <div style={{ fontSize: 18 }}>{`${Math.round(avg7)} 分/日`}</div>
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>直近30日平均</div>
                    <div style={{ fontSize: 18 }}>{`${Math.round(avg30)} 分/日`}</div>
                  </div>
                </div>
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer>
                    <LineChart data={totalSeries} margin={{ left: 16, right: 24, top: 12, bottom: 12 }}>
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

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h3 style={{ margin: "16px 0 4px", fontSize: 18 }}>タスク別の実績</h3>
                {filteredTodos.length === 0 ? (
                  <p style={{ color: "#64748b", margin: "8px 0" }}>該当するタスクがありません。</p>
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
                    const {
                      riskText,
                      badgeColors,
                      riskBorderColor,
                    } = resolveRiskDisplay(todo, displaySeries);
                    const deadlineText = deadlineAt
                      ? format(deadlineAt, "yyyy-MM-dd HH:mm")
                      : "—";
                    return (
                      <div
                        key={todo.id}
                        className="card"
                        style={{
                          padding: 16,
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
                          borderLeft: "6px solid",
                          borderLeftColor: riskBorderColor,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleToggle(task)}
                          style={{
                            width: "100%",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <div style={{ fontSize: 16, fontWeight: 600, color: "#0f172a" }}>
                              {todo.text || "(名称未設定)"}
                              {labelInfo ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 12,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    backgroundColor: labelInfo.color || "#e2e8f0",
                                    color: "#0f172a",
                                  }}
                                >
                                  {labelInfo.name || labelInfo.text || "ラベル"}
                                </span>
                              ) : null}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span
                                title="現在のリスク状況"
                                style={{
                                  fontSize: 12,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  backgroundColor: badgeColors.bg,
                                  color: badgeColors.fg,
                                  border: `1px solid ${badgeColors.bd}`,
                                  fontWeight: 600,
                                  marginRight: 6,
                                }}
                              >
                                リスク: {riskText}
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  backgroundColor: minutesToday > 0 ? "#dcfce7" : "#e2e8f0",
                                  color: "#0f172a",
                                  fontWeight: 600,
                                }}
                              >
                                今日 {minutesToday}分
                              </span>
                              <span
                                style={{
                                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                  transition: "transform 0.2s",
                                }}
                              >
                                ▶
                              </span>
                            </div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, color: "#475569", fontSize: 13 }}>
                            <div>E: {estimated != null ? formatMinutes(estimated) : "—"}</div>
                            <div>A: {formatMinutes(actualTotal)}</div>
                            <div>進捗率: {formatProgress(progressRatio)}</div>
                            <div>締切: {deadlineText}</div>
                          </div>
                        </button>
                        {isExpanded && (
                          <div style={{ marginTop: 16, width: "100%", height: 280 }}>
                            <ResponsiveContainer>
                              <ComposedChart
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
    </main>
  );
}
