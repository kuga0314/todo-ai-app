import AnalyticsTaskCard from "./AnalyticsTaskCard";

export default function AnalyticsTaskList({
  tasks,
  expandedIds,
  onToggle,
  buildTaskSeries,
  seriesCache,
  refreshTick,
  onOpenLogEditor,
}) {
  if (tasks.length === 0) {
    return (
      <p className="ana-text-muted ana-text-muted--spaced">該当するタスクがありません。</p>
    );
  }

  return tasks.map((task) => (
    <AnalyticsTaskCard
      key={task.todo.id}
      task={task}
      isExpanded={expandedIds.includes(task.todo.id)}
      series={seriesCache[task.todo.id]}
      refreshTick={refreshTick}
      onToggle={onToggle}
      buildTaskSeries={buildTaskSeries}
      onOpenLogEditor={onOpenLogEditor}
    />
  ));
}
