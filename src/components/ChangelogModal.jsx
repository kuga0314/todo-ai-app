import CHANGELOG from "../changelog";

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 1000,
};

const modalStyle = {
  background: "var(--color-surface, #fff)",
  color: "var(--color-on-surface, #1a1a1a)",
  borderRadius: "12px",
  boxShadow: "0 12px 24px rgba(0, 0, 0, 0.2)",
  maxWidth: "520px",
  width: "100%",
  maxHeight: "80vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px 20px",
  borderBottom: "1px solid rgba(0,0,0,0.08)",
};

const contentStyle = {
  padding: "16px 20px",
  overflowY: "auto",
};

const closeButtonStyle = {
  border: "none",
  background: "transparent",
  fontSize: "20px",
  cursor: "pointer",
  lineHeight: 1,
};

export default function ChangelogModal({ open, onClose }) {
  if (!open) return null;

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h3 style={{ margin: 0 }}>更新履歴</h3>
          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
            aria-label="更新履歴を閉じる"
          >
            ×
          </button>
        </div>
        <div style={contentStyle}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "16px" }}>
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
      </div>
    </div>
  );
}
