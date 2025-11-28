import { useEffect, useMemo, useState } from "react";
import { jstDateKey } from "../../utils/logUpdates";
import { calculateAverages, parseDateKey, toNumberOrNull } from "../../utils/analytics";
import AnalyticsFilters from "./AnalyticsFilters";
import AnalyticsTotalSummary from "./AnalyticsTotalSummary";
import AnalyticsTaskList from "./AnalyticsTaskList";

export default function AnalyticsView({
  loading,
  noData,
  todos: rawTodos,
  labels,
  dateRange,
  refreshTick,
  buildTaskSeries,
  ensureSeries,
  seriesCache,
  setSeriesCache,
  onOpenLogEditor,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState([]);
  const [incompleteOnly, setIncompleteOnly] = useState(() => {
    const stored = localStorage.getItem("showIncompleteOnly");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("showIncompleteOnly", String(incompleteOnly));
  }, [incompleteOnly]);

  const todayKey = useMemo(() => jstDateKey(new Date()), []);

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
      const progressRatio = estimated && estimated > 0 ? actualTotal / estimated : null;
      const deadlineAt = todo.deadline?.toDate?.() ? todo.deadline.toDate() : null;
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

  useEffect(() => {
    if (!dateRange.length || !sortedTodos.length) {
      setExpandedIds([]);
      setSeriesCache({});
      return;
    }

    const initial = sortedTodos.slice(0, 5).map(({ todo }) => todo.id);
    setExpandedIds(initial);
    setSeriesCache(() => {
      const nextCache = {};
      initial.forEach((id) => {
        const task = sortedTodos.find(({ todo }) => todo.id === id);
        if (task) {
          nextCache[id] = buildTaskSeries(task.todo);
        }
      });
      return nextCache;
    });
  }, [dateRange, sortedTodos, buildTaskSeries, setSeriesCache]);

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

  if (loading) {
    return <p className="ana-text-muted">読み込み中…</p>;
  }

  if (noData || !dateRange.length) {
    return <p className="ana-text-muted">データがありません</p>;
  }

  return (
    <div className="ana-content">
      <AnalyticsFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        incompleteOnly={incompleteOnly}
        onIncompleteChange={setIncompleteOnly}
        labelFilter={labelFilter}
        onLabelChange={setLabelFilter}
        labels={labels}
      />

      <AnalyticsTotalSummary
        totalSeries={totalSeries}
        totalMinutes={totalMinutes}
        avg7={avg7}
        avg30={avg30}
        refreshTick={refreshTick}
      />

      <div className="ana-task-section">
        <h3 className="ana-section-title ana-section-title--sub">タスク別の実績</h3>
        <AnalyticsTaskList
          tasks={filteredTodos}
          expandedIds={expandedIds}
          onToggle={handleToggle}
          buildTaskSeries={buildTaskSeries}
          seriesCache={seriesCache}
          refreshTick={refreshTick}
          onOpenLogEditor={onOpenLogEditor}
        />
      </div>
    </div>
  );
}
