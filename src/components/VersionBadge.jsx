import useBuildMeta from "../hooks/useBuildMeta";
import { Sparkle } from "phosphor-react";

export default function VersionBadge({ onClick, className = "", as = "button" }) {
  const { meta } = useBuildMeta();
  const builtAt = meta?.builtAt ? new Date(meta.builtAt) : null;
  const builtAtLabel = builtAt?.toLocaleString("ja-JP", {
    hour12: false,
  });

  const title = `commit: ${meta.commit}\nbranch: ${meta.branch}\nbuilt: ${
    builtAtLabel || meta.builtAt
  }`;

  const sharedProps = {
    className: `version-badge hdr-chip hdr-chip--ghost ${className}`,
    title,
    "aria-label": `バージョン ${meta.version}。コミット ${meta.commit}。ブランチ ${meta.branch}。ビルド日時 ${
      builtAtLabel || meta.builtAt
    }。`,
  };

  const handleKey = (e) => {
    if (!onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick(e);
    }
  };

  if (as === "button") {
    return (
      <button type="button" onClick={onClick} {...sharedProps}>
        <Sparkle size={18} weight="fill" className="hdr-chip__icon" aria-hidden />
        <span className="version-badge__text">v{meta.version}</span>
      </button>
    );
  }

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKey}
      {...sharedProps}
    >
      <Sparkle size={18} weight="fill" className="hdr-chip__icon" aria-hidden />
      <span className="version-badge__text">v{meta.version}</span>
    </div>
  );
}
