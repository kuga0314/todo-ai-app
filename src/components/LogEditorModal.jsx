import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { applyLogDiff, jstDateKey } from "../utils/logUpdates";
import "./LogEditorModal.css";

const toDate = (value) => value?.toDate?.() ?? (value instanceof Date ? value : null);
const parseDateKey = (key) => {
  if (!key) return null;
  const [y, m, d] = key.split("-").map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
};

export default function LogEditorModal({
  open,
  onClose,
  todo,
  defaultDate,
  onSaved,
}) {
  const [dateKey, setDateKey] = useState(defaultDate || jstDateKey());
  const [existingInput, setExistingInput] = useState("0");
  const [additionInput, setAdditionInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const oldValue = useMemo(() => {
    const actualLogs = todo?.actualLogs ?? {};
    return Math.max(0, Math.round(Number(actualLogs?.[dateKey]) || 0));
  }, [todo, dateKey]);

  useEffect(() => {
    if (!open) return;
    const key = defaultDate || jstDateKey();
    setDateKey(key);
  }, [open, defaultDate, todo?.id]);

  useEffect(() => {
    if (!open) return;
    const actualLogs = todo?.actualLogs ?? {};
    const nextExisting = Math.max(
      0,
      Math.round(Number(actualLogs?.[dateKey]) || 0)
    );
    setExistingInput(String(nextExisting));
    setAdditionInput("");
    setError("");
  }, [open, dateKey, todo]);

  if (!open || !todo) return null;

  const handleClose = () => {
    if (saving) return;
    onClose?.();
  };

  const sanitizeMinutes = (value) => {
    const num = Math.round(Number(value));
    return Number.isFinite(num) && num > 0 ? num : 0;
  };

  const sanitizedExisting = sanitizeMinutes(existingInput);
  const sanitizedAddition = sanitizeMinutes(additionInput);
  const newValue = sanitizedExisting + sanitizedAddition;
  const delta = newValue - oldValue;
  const nextTotal = Math.max(
    0,
    Math.round(Number(todo?.actualTotalMinutes) || 0) + delta
  );
  const deadline = toDate(todo.deadline);
  const dateForTitle = parseDateKey(dateKey);

  const handleSave = async () => {
    if (saving) return;
    if (!dateKey) {
      setError("日付を選択してください。");
      return;
    }
    if (sanitizedExisting < 0 || sanitizedAddition < 0) {
      setError("分数は0以上を入力してください。");
      return;
    }
    if (newValue === oldValue) {
      if (sanitizedAddition === 0) {
        onClose?.();
        return;
      }
    }
    if (newValue === 0 && oldValue > 0) {
      const ok = window.confirm("この日のログを削除しますか？");
      if (!ok) return;
    }
    if (Math.round(Number(todo?.actualTotalMinutes) || 0) + delta < 0) {
      setError("累積実績が負になるため保存できません。");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const { delta } = await applyLogDiff({
        todoId: todo.id,
        dateKey,
        newValue,
        oldValue,
        actualTotalMinutes: todo.actualTotalMinutes,
        source: "manual",
        trigger: "log-editor",
      });
      onSaved?.({ todoId: todo.id, dateKey, delta });
      alert("保存しました");
      onClose?.();
    } catch (err) {
      console.error("apply log diff failed", err);
      setError(err?.message || "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lem-overlay" onMouseDown={handleClose}>
      <div
        className="lem-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="ログ編集モーダル"
      >
        <div className="lem-header">
          <div className="lem-header__info">
            <h3 className="lem-title">{todo.text}</h3>
            {deadline ? (
              <p className="lem-deadline">
                締切: {format(deadline, "yyyy/MM/dd HH:mm")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="lem-btn"
          >
            閉じる
          </button>
        </div>

        <div className="lem-section">
          <label className="lem-label" htmlFor="log-editor-date">
            日付
          </label>
          <input
            id="log-editor-date"
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            className="lem-input"
          />
          <p className="lem-note">
            選択した日の合計実績を編集します。
          </p>
        </div>

        <div className="lem-section lem-section--lg">
          <label className="lem-label" htmlFor="log-editor-existing">
            この日の既存ログ（合計分）
          </label>
          <input
            id="log-editor-existing"
            type="number"
            min={0}
            step={1}
            value={existingInput}
            onChange={(e) => setExistingInput(e.target.value)}
            className="lem-input"
          />
          <div className="lem-meta-row">
            <span>元の値: {oldValue} 分</span>
            <button
              type="button"
              onClick={() => {
                if (oldValue <= 0) return;
                const ok = window.confirm("この日のログを0分にしますか？");
                if (!ok) return;
                setExistingInput("0");
                setAdditionInput("");
              }}
              className="lem-btn lem-btn--danger"
              disabled={oldValue <= 0}
            >
              削除
            </button>
          </div>
        </div>

        <div className="lem-section lem-section--lg">
          <label className="lem-label" htmlFor="log-editor-addition">
            新規追加（この値は既存ログに加算されます）
          </label>
          <input
            id="log-editor-addition"
            type="number"
            min={0}
            step={1}
            placeholder="例: 30"
            value={additionInput}
            onChange={(e) => setAdditionInput(e.target.value)}
            className="lem-input"
          />
        </div>

        <div className="lem-summary-card">
          <div>保存後のこの日の合計: {newValue} 分</div>
          <div>差分: {delta >= 0 ? `+${delta}` : delta} 分</div>
          <div>累積実績（予測）: {nextTotal} 分</div>
          {dateForTitle ? (
            <div>
              編集対象日: {format(dateForTitle, "yyyy/MM/dd (EEE)")}
            </div>
          ) : null}
        </div>

        {error ? <p className="lem-error">{error}</p> : null}

        <div className="lem-footer">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="lem-btn lem-btn--primary"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
