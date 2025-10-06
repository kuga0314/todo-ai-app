import { NavLink } from "react-router-dom";
import "./BottomNav.css";

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink
        to="/"
        end
        className={({ isActive }) => (isActive ? "tab-item active" : "tab-item")}
      >
        <span role="img" aria-label="home">🏠</span>
        <span className="tab-label">ホーム</span>
      </NavLink>

      <NavLink
        to="/progress"
        className={({ isActive }) => (isActive ? "tab-item active" : "tab-item")}
      >
        <span role="img" aria-label="progress">⏱️</span>
        <span className="tab-label">進捗</span>
      </NavLink>

      <NavLink
        to="/all-tasks"
        className={({ isActive }) => (isActive ? "tab-item active" : "tab-item")}
      >
        <span role="img" aria-label="tasks">📋</span>
        <span className="tab-label">タスク</span>
      </NavLink>

      <NavLink
        to="/settings"
        className={({ isActive }) => (isActive ? "tab-item active" : "tab-item")}
      >
        <span role="img" aria-label="settings">⚙️</span>
        <span className="tab-label">設定</span>
      </NavLink>
    </nav>
  );
}
