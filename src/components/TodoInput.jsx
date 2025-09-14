// src/components/TodoInput.jsx
import { useState } from "react";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { levelToMinutes } from "../utils/levelHours"; // 過渡期フォールバック用
import { useAuth } from "../hooks/useAuth";
import "./TodoInput.css";

export default function TodoInput() {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [scale, setScale] = useState(3);       // 表示は「規模レベル」
  const [priority, setPriority] = useState(2);
  const [estimatedMinutes, setEstimatedMinutes] = useState(""); // ★ 新規：E（分）
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setText("");
    setDeadline("");
    setScale(3);
    setPriority(2);
    setEstimatedMinutes("");
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!user || !text.trim() || saving) return;
    setSaving(true);
    try {
      const deadlineTS = deadline ? Timestamp.fromDate(new Date(deadline)) : null;

      // E が未入力なら互換フォールバック（後日撤去予定）
      const E =
        estimatedMinutes !== "" && Number(estimatedMinutes) > 0
          ? Math.round(Number(estimatedMinutes))
          : levelToMinutes(scale);

      await addDoc(collection(db, "todos"), {
        userId: user.uid,
        text: text.trim(),
        completed: false,
        deadline: deadlineTS,
        scale,
        priority,
        estimatedMinutes: E,      // ← ユーザー入力Eを最優先で保存
        notified: false,
        createdAt: Timestamp.now(),
      });

      reset();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ti" onSubmit={handleSubmit}>
      {/* 上段：やること */}
      <input
        className="ti-input"
        type="text"
        placeholder="やることを入力..."
        aria-label="やること"
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
      />

      {/* 下段：締切・規模・優先度・E・追加 */}
      <div className="ti-row">
        <input
          className="ti-datetime"
          type="datetime-local"
          aria-label="締切"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          required
        />

        <label className="ti-field">
          規模
          <select
            className="ti-select"
            value={scale}
            onChange={(e) => setScale(+e.target.value)}
            aria-label="規模"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label className="ti-field">
          優先度
          <select
            className="ti-select"
            value={priority}
            onChange={(e) => setPriority(+e.target.value)}
            aria-label="優先度"
          >
            <option value={1}>低</option>
            <option value={2}>中</option>
            <option value={3}>高</option>
          </select>
        </label>

        <label className="ti-field">
          所要時間（分）E
          <input
            className="ti-number"
            type="number"
            min={1}
            step={1}
            placeholder="例: 90"
            aria-label="所要時間（分）"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
          />
        </label>

        <button className="ti-submit" type="submit" disabled={saving}>
          {saving ? "追加中…" : "＋ 追加"}
        </button>
      </div>
    </form>
  );
}
