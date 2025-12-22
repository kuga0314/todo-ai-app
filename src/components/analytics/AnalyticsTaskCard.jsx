import { useEffect, useMemo, useRef, useState } from "react";
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
import { formatMinutes, formatProgress } from "../../utils/analytics";

export default function AnalyticsTaskCard({
  task,
  isExpanded,
  series,
  refreshTick,
  onToggle,
  buildTaskSeries,
  onOpenLogEditor,
}) {
  const [isMobile, setIsMobile] = useState(false);
  const chartScrollRefs = [useRef(null), useRef(null)];
  const {
    todo,
    estimated,
    actualTotal,
    progressRatio,
    deadlineAt,
    labelInfo,
    minutesToday,
    riskKey,
    riskText,
    requiredPerDay,
    requiredMinutesForWarn,
    requiredMinutesForOk,
    isBeforeStart,
  } = task;
  const displaySeries = series || buildTaskSeries(task.todo);
  const hasTaskLogs = displaySeries.some((item) => Number(item.minutes) > 0);
  const latestEacTs = (() => {
    for (let i = displaySeries.length - 1; i >= 0; i -= 1) {
      if (displaySeries[i].eacTs != null) return displaySeries[i].eacTs;
    }
    return null;
  })();
  const latestEacText = latestEacTs ? format(new Date(latestEacTs), "yyyy-MM-dd") : "—";
  const displayRisk = isBeforeStart ? "⏳ 開始前" : riskText;
  const cardRiskKey = isBeforeStart ? "none" : riskKey || "none";
  const deadlineText = deadlineAt ? format(deadlineAt, "yyyy-MM-dd HH:mm") : "—";
  const todayBadgeClass = `ana-badge ana-badge--today${minutesToday > 0 ? " is-active" : ""}`;
  const improvementMessages = [];
  if (!isBeforeStart) {
    if (cardRiskKey === "late" && Number.isFinite(requiredMinutesForWarn) && requiredMinutesForWarn > 0) {
      improvementMessages.push(`今日 ${requiredMinutesForWarn} 分で🟡注意まで`);
    }
    if (
      (cardRiskKey === "late" || cardRiskKey === "warn") &&
      Number.isFinite(requiredMinutesForOk) &&
      requiredMinutesForOk > 0
    ) {
      improvementMessages.push(`今日 ${requiredMinutesForOk} 分で🟢良好へ`);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const query = window.matchMedia("(max-width: 640px)");
    const handleChange = (event) => setIsMobile(event.matches);

    handleChange(query);
    query.addEventListener?.("change", handleChange);

    return () => {
      query.removeEventListener?.("change", handleChange);
    };
  }, []);

  const mobileChartWidth = useMemo(() => {
    const mobileViewportDays = 7;
    const dayWidth = 56;

    if (!Array.isArray(displaySeries) || displaySeries.length === 0) {
      return dayWidth * mobileViewportDays;
    }

    return Math.max(displaySeries.length * dayWidth, dayWidth * mobileViewportDays);
  }, [displaySeries]);

  useEffect(() => {
    if (!isMobile) return;

    chartScrollRefs.forEach((ref) => {
      if (ref.current) {
        ref.current.scrollLeft = ref.current.scrollWidth;
      }
    });
  }, [isMobile, mobileChartWidth, refreshTick]);

  const renderPerformanceChart = (chartProps = {}) => (
    <ComposedChart
      key={`${todo.id}:${refreshTick}:chart`}
      data={displaySeries}
      margin={{ left: 16, right: 24, top: 12, bottom: 12 }}
      {...chartProps}
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
          if (key === "spiStable")
            return [
              Number.isFinite(Number(value)) ? Number(value).toFixed(2) : value,
              "SPI（週間ペース）",
            ];
          if (key === "spiShort")
            return [
              Number.isFinite(Number(value)) ? Number(value).toFixed(2) : value,
              "SPI（短期評価：直近7日で実績<3日）",
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
        dataKey="spiStable"
        name="SPI（週間ペース）"
        stroke="#10b981"
        strokeWidth={2}
        dot={false}
      />
      <Line
        yAxisId="right"
        type="monotone"
        dataKey="spiShort"
        name="SPI（短期評価）"
        stroke="#94a3b8"
        strokeWidth={2}
        dot={false}
        strokeDasharray="4 2"
        opacity={0.9}
      />
    </ComposedChart>
  );

  const renderEacChart = (chartProps = {}) => (
    <ComposedChart
      key={`${todo.id}:${refreshTick}:chart-eac`}
      data={displaySeries}
      margin={{ left: 16, right: 24, top: 12, bottom: 12 }}
      {...chartProps}
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
  );

  const renderChartWrapper = ({ refIndex, children, style }) => {
    if (!isMobile) {
      return (
        <div className="ana-chart ana-chart--task" style={style}>
          {children}
        </div>
      );
    }

    return (
      <div className="ana-chart ana-chart--task ana-chart--scroll" style={style}>
        <div ref={chartScrollRefs[refIndex]} className="ana-chart__scroller">
          <div className="ana-chart__inner" style={{ width: `${mobileChartWidth}px`, height: "280px" }}>
            {children}
          </div>
        </div>
      </div>
    );
  };

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
          <div
            title="Estimate（見積時間）：タスク完了に必要だと最初に見積もった合計作業時間（分）"
          >
            E: {estimated != null ? formatMinutes(estimated) : "—"}
          </div>
          <div
            title="Actual（実績時間）：これまでに記録した合計作業時間（分）"
          >
            A: {formatMinutes(actualTotal)}
          </div>
          <div
            title="進捗率 = A ÷ E。1（100%）なら見積もり通り、1以上なら見積より速いペース"
          >
            進捗率: {formatProgress(progressRatio)}
          </div>
          <div
            title="タスクの締切日時。この時間までに見積時間Eを消化する前提でSPIなどを計算しています"
          >
            締切: {deadlineText}
          </div>
          <div
            title="EAC（予測完了日）：現在のペースが続いた場合に、このタスクが完了すると予測される日付。締切より後になると遅延リスクが高い状態です"
          >
            EAC(完了予測日): {latestEacText}
          </div>
          <div>
            今日の目安:
            {improvementMessages.length
              ? ` ${improvementMessages.join(" / ")}`
              : requiredPerDay != null && !isBeforeStart
              ? ` ${Math.ceil(requiredPerDay)} 分/日`
              : " —"}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className={`ana-card__chart${isExpanded ? " is-open" : ""}`}>
          {hasTaskLogs ? (
            <>
              {renderChartWrapper({
                refIndex: 0,
                children: isMobile ? (
                  renderPerformanceChart({ width: mobileChartWidth, height: 280 })
                ) : (
                  <ResponsiveContainer key={`${todo.id}:${refreshTick}`}>
                    {renderPerformanceChart()}
                  </ResponsiveContainer>
                ),
              })}
              {renderChartWrapper({
                refIndex: 1,
                style: { marginTop: 16 },
                children: isMobile ? (
                  renderEacChart({ width: mobileChartWidth, height: 280 })
                ) : (
                  <ResponsiveContainer key={`${todo.id}:${refreshTick}:eac`}>
                    {renderEacChart()}
                  </ResponsiveContainer>
                ),
              })}
            </>
          ) : (
            <p className="ana-text-muted ana-text-muted--spaced">ログがありません</p>
          )}
        </div>
      )}
    </div>
  );
}
