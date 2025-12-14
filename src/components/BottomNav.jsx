import { NavLink } from "react-router-dom";
import {
  ChartLine,
  GearSix,
  HouseLine,
  IconContext,
  Gauge,
  ListChecks,
} from "phosphor-react";
import "./BottomNav.css";

const tabs = [
  { to: "/", label: "ホーム", Icon: HouseLine, end: true },
  { to: "/progress", label: "進捗", Icon: Gauge },
  { to: "/all-tasks", label: "タスク", Icon: ListChecks },
  { to: "/analytics", label: "分析", Icon: ChartLine },
  { to: "/settings", label: "設定", Icon: GearSix },
];

export default function BottomNav() {
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
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </IconContext.Provider>
  );
}
