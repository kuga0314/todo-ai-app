export default function AnalyticsFilters({
  searchTerm,
  onSearchChange,
  incompleteOnly,
  onIncompleteChange,
  labelFilter,
  onLabelChange,
  labels,
}) {
  return (
    <div className="ana-filters">
      <input
        type="search"
        placeholder="タスク名で検索"
        value={searchTerm}
        onChange={(event) => onSearchChange(event.target.value)}
        className="ana-input"
      />
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          whiteSpace: "nowrap",
        }}
      >
        <input
          type="checkbox"
          checked={incompleteOnly}
          onChange={(event) => onIncompleteChange(event.target.checked)}
        />
        未完タスクのみ表示
      </label>
      {labels.length > 0 && (
        <select
          value={labelFilter}
          onChange={(event) => onLabelChange(event.target.value)}
          className="ana-select"
        >
          <option value="all">すべてのラベル</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name || label.text || "(無題ラベル)"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
