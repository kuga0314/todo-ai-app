import CHANGELOG from "../changelog";
import useBuildMeta from "../hooks/useBuildMeta";

const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "16px",
};

export default function VersionInfo() {
  const { meta, loading } = useBuildMeta();
  const builtAtDate = meta?.builtAt ? new Date(meta.builtAt) : null;
  const builtAtLabel = builtAtDate?.toLocaleString("ja-JP", { hour12: false });

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h3>バージョン情報＋更新履歴</h3>

      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        <div>
          <strong>現在のバージョン:</strong>{" "}
          <span>{loading ? "読み込み中…" : `v${meta.version}`}</span>
        </div>
        <div>
          <strong>コミット:</strong>{" "}
          <span>
            {loading
              ? "読み込み中…"
              : `${meta.commit} (${meta.branch})`}
          </span>
        </div>
        <div>
          <strong>ビルド日時:</strong>{" "}
          <span>{loading ? "読み込み中…" : builtAtLabel || meta.builtAt}</span>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h4 style={{ marginBottom: 12 }}>更新履歴</h4>
        <ul style={listStyle}>
          {CHANGELOG.map((entry, index) => (
            <li
              key={entry.version}
              style={{
                borderBottom:
                  index === CHANGELOG.length - 1
                    ? "none"
                    : "1px solid rgba(0,0,0,0.05)",
                paddingBottom: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                <strong style={{ fontSize: "16px" }}>v{entry.version}</strong>
                <span style={{ color: "#666", fontSize: "13px" }}>{entry.date}</span>
                <span style={{ fontWeight: 600 }}>{entry.title}</span>
              </div>
              <ul style={{ margin: 0, paddingInlineStart: "20px", display: "grid", gap: 4 }}>
                {entry.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
