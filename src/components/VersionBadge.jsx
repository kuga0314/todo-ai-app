import useBuildMeta from "../hooks/useBuildMeta";
import { Sparkle } from "phosphor-react";

export default function VersionBadge({ onClick, className = "" }) {
  const { meta } = useBuildMeta();
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
      className={`version-badge hdr-chip hdr-chip--ghost ${className}`}
      title={title}
      aria-label={`バージョン ${meta.version}。コミット ${meta.commit}。ブランチ ${meta.branch}。ビルド日時 ${
        builtAtLabel || meta.builtAt
      }。`}
    >
      <Sparkle size={18} weight="fill" className="hdr-chip__icon" aria-hidden />
      <span className="version-badge__text">v{meta.version}</span>
    </button>
  );
}
