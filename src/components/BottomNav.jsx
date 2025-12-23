import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  ChartLine,
  GearSix,
  HouseLine,
  IconContext,
  Gauge,
  ListChecks,
} from "phosphor-react";
import {
  ANALYTICS_ATTENTION_EVENT,
  getAnalyticsAttentionKey,
  readAnalyticsAttention,
} from "../utils/analyticsAlert";
import "./BottomNav.css";

const tabs = [
  { to: "/", label: "ホーム", Icon: HouseLine, end: true },
  { to: "/progress", label: "進捗", Icon: Gauge },
  { to: "/all-tasks", label: "タスク", Icon: ListChecks },
  { to: "/analytics", label: "分析", Icon: ChartLine },
  { to: "/settings", label: "設定", Icon: GearSix },
];

export default function BottomNav() {
  const [analyticsAlert, setAnalyticsAlert] = useState(() => readAnalyticsAttention());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleAttention = (event) => {
      if (event?.type === ANALYTICS_ATTENTION_EVENT) {
        setAnalyticsAlert(Boolean(event.detail?.active));
      }
    };

    const handleStorage = (event) => {
      const key = getAnalyticsAttentionKey();
      if (event?.key && event.key !== key) return;
      setAnalyticsAlert(readAnalyticsAttention());
    };

    window.addEventListener(ANALYTICS_ATTENTION_EVENT, handleAttention);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(ANALYTICS_ATTENTION_EVENT, handleAttention);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return (
    <IconContext.Provider value={{ size: 26, color: "currentColor" }}>
      <nav className="bottom-nav">
        {tabs.map((tab) => {
          const { to, label, Icon: TabIcon, end } = tab;

          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? "tab-item active" : "tab-item")}
            >
              {({ isActive }) => (
                <>
                  <TabIcon
                    weight={isActive ? "fill" : "regular"}
                    className="tab-icon"
                    aria-hidden="true"
                    title={label}
                  />
                  <span className="tab-label">{label}</span>
                  {to === "/analytics" && analyticsAlert && !isActive ? (
                    <span className="tab-alert" aria-label="分析に更新があります">
                      !
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </IconContext.Provider>
  );
}
