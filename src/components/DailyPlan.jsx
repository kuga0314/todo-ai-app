// src/components/DailyPlan.jsx
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
import { useAuth } from "../hooks/useAuth";
import { db } from "../firebase/firebaseConfig";
import { useDailyPlan } from "../hooks/useDailyPlan";

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
                <>
                  <div style={{ marginBottom: 8 }}>
                    合計 <b>{activePlan.used}</b> 分
                    {Number.isFinite(activePlan.cap) && (
                      <span style={{ marginLeft: 6, opacity: 0.7 }}>
                        （上限 {activePlan.cap} 分）
                      </span>
                    )}
                  </div>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                    }}
                  >
                    {activePlan.items.map((it, idx) => (
                      <li
                        key={it.id}
                        className="daily-plan-item"
                        style={{
                          "--item-index": idx,
                          display: "flex",
                          alignItems: "center",
                          padding: "6px 0",
                          borderTop:
                            idx === 0 ? "none" : "1px solid rgba(0,0,0,0.06)",
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: it.labelColor || "transparent",
                            display: "inline-block",
                            marginRight: 8,
                            border: "1px solid rgba(0,0,0,0.1)",
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {idx + 1}. {it.text}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            目安 {it.todayMinutes} 分
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div style={{ marginTop: 24 }}>
                <h4 style={{ margin: "16px 0 8px" }}>Planned vs Actual</h4>
                {!chartTotals.hasData ? (
                  <p style={{ color: "#666", fontSize: 13 }}>
                    今日の割当と実績データはまだありません。
                  </p>
                ) : (
                  <>
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartDataWithSummary} margin={{ bottom: 40 }}>
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
                    <table
                      style={{
                        width: "100%",
                        marginTop: 12,
                        borderCollapse: "collapse",
                        fontSize: 13,
                      }}
                    >
                      <thead>
                        <tr style={{ textAlign: "left" }}>
                          <th style={{ padding: "6px 4px" }}>タスク</th>
                          <th style={{ padding: "6px 4px", textAlign: "right" }}>
                            予定 (分)
                          </th>
                          <th style={{ padding: "6px 4px", textAlign: "right" }}>
                            実績 (分)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartData.map((row) => (
                          <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                            <td style={{ padding: "6px 4px" }}>{row.name}</td>
                            <td style={{ padding: "6px 4px", textAlign: "right" }}>
                              {row.planned}
                            </td>
                            <td style={{ padding: "6px 4px", textAlign: "right" }}>
                              {row.actual}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid #ccc", fontWeight: 600 }}>
                          <td style={{ padding: "6px 4px" }}>合計</td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>
                            {chartTotals.planned}
                          </td>
                          <td style={{ padding: "6px 4px", textAlign: "right" }}>
                            {chartTotals.actual}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
