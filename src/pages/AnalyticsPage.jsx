import { useMemo, useState } from "react";
import { useAuth } from "../hooks/useAuth.jsx";
import LogEditorModal from "../components/LogEditorModal";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import AnalyticsView from "../components/analytics/AnalyticsView";
import useTaskSeries from "../hooks/useTaskSeries";
import { jstDateKey } from "../utils/logUpdates";
import "./Analytics.css";

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [refreshTick, setRefreshTick] = useState(0);
  const { loading, noData, todos, labels, dateRange } = useAnalyticsData(
    user?.uid,
    refreshTick
  );
  const { buildTaskSeries, ensureSeries, invalidateSeries, seriesCache, setSeriesCache } =
    useTaskSeries({
      dateRange,
      refreshTick,
    });
  const [logEditorState, setLogEditorState] = useState({
    open: false,
    todo: null,
    date: null,
  });

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

  function handleLogSaved(payload) {
    setRefreshTick((t) => t + 1);
    if (!payload?.todoId) return;
    invalidateSeries(payload.todoId);
  }

  return (
    <main className="app-main">
      <div className="container ana-layout">
        <section className="card ana-card-section">
          <header className="ana-section-header">
            <h2 className="ana-page-title">📊 分析</h2>
          </header>

          <AnalyticsView
            loading={loading}
            noData={noData}
            todos={todos}
            labels={labels}
            dateRange={dateRange}
            refreshTick={refreshTick}
            buildTaskSeries={buildTaskSeries}
            ensureSeries={ensureSeries}
            seriesCache={seriesCache}
            setSeriesCache={setSeriesCache}
            onOpenLogEditor={openLogEditorForTodo}
          />
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
