import { format } from "date-fns";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatMinutes,
  formatProgress,
  resolveRiskDisplay,
} from "../../utils/analytics";

export default function AnalyticsTaskCard({
  task,
  isExpanded,
  series,
  refreshTick,
  onToggle,
  buildTaskSeries,
  onOpenLogEditor,
}) {
  const { todo, estimated, actualTotal, progressRatio, deadlineAt, labelInfo, minutesToday } =
    task;
  const displaySeries = series || buildTaskSeries(task.todo);
  const hasTaskLogs = displaySeries.some((item) => Number(item.minutes) > 0);
  const latestEacTs = (() => {
    for (let i = displaySeries.length - 1; i >= 0; i -= 1) {
      if (displaySeries[i].eacTs != null) return displaySeries[i].eacTs;
    }
    return null;
  })();
  const latestEacText = latestEacTs ? format(new Date(latestEacTs), "yyyy-MM-dd") : "—";
  const { riskKey, riskText, isBeforeStart } = resolveRiskDisplay(todo);
  const displayRisk = isBeforeStart ? "⏳ 開始前" : riskText;
  const cardRiskKey = isBeforeStart ? "none" : riskKey || "none";
  const deadlineText = deadlineAt ? format(deadlineAt, "yyyy-MM-dd HH:mm") : "—";
  const todayBadgeClass = `ana-badge ana-badge--today${minutesToday > 0 ? " is-active" : ""}`;

  return (
    <div key={todo.id} className={`card ana-card ana-card--risk-${cardRiskKey}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(task)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(task);
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
                style={labelInfo.color ? { "--ana-label-bg": labelInfo.color } : undefined}
              >
                {labelInfo.name || labelInfo.text || "ラベル"}
              </span>
            ) : null}
          </div>
          <div className="ana-head__actions">
            <span className={`ana-badge ana-badge--risk-${cardRiskKey}`} title="現在のリスク状況">
              リスク: {displayRisk}
            </span>
            <span className={todayBadgeClass}>
              今日: {minutesToday > 0 ? `${minutesToday}分` : "なし"}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenLogEditor(todo);
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
          <div>EAC(完了予測日): {latestEacText}</div>
        </div>
      </div>
      {isExpanded && (
        <div className="ana-card__chart">
          {hasTaskLogs ? (
            <>
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
                      formatter={(value, _name, entry) => {
                        const key = entry?.dataKey || _name;
                        if (key === "minutes") return [`${value} 分`, "日別実績"];
                        if (key === "cum") return [`${value} 分`, "累積実績"];
                        if (key === "spi")
                          return [
                            Number.isFinite(Number(value)) ? Number(value).toFixed(2) : value,
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
              <div className="ana-chart ana-chart--task" style={{ marginTop: 16 }}>
                <ResponsiveContainer key={`${todo.id}:${refreshTick}:eac`}>
                  <ComposedChart
                    key={`${todo.id}:${refreshTick}:chart-eac`}
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
                        value: "残り(分)",
                        angle: -90,
                        position: "insideLeft",
                        style: { textAnchor: "middle" },
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(value) => (value ? format(new Date(value), "MM/dd") : "—")}
                      label={{
                        value: "EAC予測日",
                        angle: 90,
                        position: "insideRight",
                        style: { textAnchor: "middle" },
                      }}
                    />
                    <Tooltip
                      formatter={(value, _name, entry) => {
                        const key = entry?.dataKey || _name;
                        if (key === "remaining") return [`残り: ${value} 分`, "残り作業"];
                        if (key === "eacTs") {
                          if (value == null) return ["—", "EAC予測日"];
                          return [format(new Date(value), "yyyy-MM-dd"), "EAC予測日"];
                        }
                        return value;
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="remaining"
                      name="残り(分)"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="eacTs"
                      name="EAC予測日"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="4 2"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="ana-text-muted ana-text-muted--spaced">ログがありません</p>
          )}
        </div>
      )}
    </div>
  );
}
