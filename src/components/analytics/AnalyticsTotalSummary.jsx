import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatMinutes } from "../../utils/analytics";

export default function AnalyticsTotalSummary({ totalSeries, totalMinutes, avg7, avg30, refreshTick }) {
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef(null);
  const hasLogs = totalSeries.some((item) => Number(item.minutes) > 0);

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

    if (!Array.isArray(totalSeries) || totalSeries.length === 0) {
      return dayWidth * mobileViewportDays;
    }

    return Math.max(totalSeries.length * dayWidth, dayWidth * mobileViewportDays);
  }, [totalSeries]);

  useEffect(() => {
    if (!isMobile || !scrollRef.current) return;

    scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [isMobile, mobileChartWidth, refreshTick]);

  const renderChartContents = (chartProps = {}) => (
    <LineChart
      key={`total-chart:${refreshTick}`}
      data={totalSeries}
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
        stroke="var(--chart-actual)"
        strokeWidth={2}
        dot={false}
      />
    </LineChart>
  );

  return (
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
      <div className={`ana-chart${isMobile ? " ana-chart--scroll" : ""}`}>
        {hasLogs ? (
          isMobile ? (
            <div ref={scrollRef} className="ana-chart__scroller">
              <div className="ana-chart__inner" style={{ width: `${mobileChartWidth}px`, height: "320px" }}>
                {renderChartContents({ width: mobileChartWidth, height: 320 })}
              </div>
            </div>
          ) : (
            <ResponsiveContainer key={`total:${refreshTick}`}>
              {renderChartContents()}
            </ResponsiveContainer>
          )
        ) : (
          <p className="ana-text-muted ana-text-muted--spaced">ログがありません</p>
        )}
      </div>
    </div>
  );
}
