import { useState } from "react";
import useBuildMeta from "../hooks/useBuildMeta";

const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  background: "var(--color-surface, #f0f4ff)",
  color: "var(--color-on-surface, #1a237e)",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  fontSize: "12px",
  fontWeight: 600,
  lineHeight: 1.4,
  cursor: "pointer",
  transition: "background 0.2s ease, color 0.2s ease",
};

const hoverStyle = {
  background: "var(--color-surface-variant, #e3f2fd)",
  color: "var(--color-on-surface-variant, #0d47a1)",
};

export default function VersionBadge({ onClick }) {
  const { meta } = useBuildMeta();
  const [hovered, setHovered] = useState(false);
  const builtAt = meta?.builtAt ? new Date(meta.builtAt) : null;
  const builtAtLabel = builtAt?.toLocaleString("ja-JP", {
    hour12: false,
  });

  const title = `commit: ${meta.commit}\nbranch: ${meta.branch}\nbuilt: ${
    builtAtLabel || meta.builtAt
  }`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="version-badge"
      title={title}
      aria-label={`バージョン ${meta.version}。コミット ${meta.commit}。ブランチ ${meta.branch}。ビルド日時 ${
        builtAtLabel || meta.builtAt
      }。`}
      style={{ ...badgeStyle, ...(hovered ? hoverStyle : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      v{meta.version}
    </button>
  );
}
