// src/components/TodoInput.jsx
import { useState, useEffect } from "react";
import { collection, addDoc, Timestamp, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { levelToMinutes } from "../utils/levelHours"; // 過渡期フォールバック用
import { useAuth } from "../hooks/useAuth";
import "./TodoInput.css";

export default function TodoInput() {
  const { user } = useAuth();

  // 入力フィールド
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [scale, setScale] = useState(3); // 表示は「規模レベル」
  const [priority, setPriority] = useState(2);
  const [estimatedMinutes, setEstimatedMinutes] = useState(""); // E（分）
  const [saving, setSaving] = useState(false);

  // ★ ラベル（1タスク=1ラベル）
  const [labels, setLabels] = useState([]);
  const [selectedLabelId, setSelectedLabelId] = useState("");

  // ラベル購読（設定ページで作成した labels を取得）
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, "users", user.uid, "labels");
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() ?? {}) }));
      // 追加・削除に即応
      setLabels(rows);
      // 選択中ラベルが消えた場合は解除
      if (rows.findIndex((r) => r.id === selectedLabelId) === -1) {
        setSelectedLabelId("");
      }
    });
    return () => unsub();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setText("");
    setDeadline("");
    setScale(3);
    setPriority(2);
    setEstimatedMinutes("");
    setSelectedLabelId("");
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
        estimatedMinutes: E, // ← ユーザー入力Eを最優先で保存
        labelId: selectedLabelId || null, // ★ ラベルの関連付け
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

      {/* 下段：締切・規模・優先度・ラベル・E・追加 */}
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
              <option key={n} value={n}>
                {n}
              </option>
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

        {/* ★ ラベル選択 */}
        <label className="ti-field">
          ラベル
          <select
            className="ti-select"
            value={selectedLabelId}
            onChange={(e) => setSelectedLabelId(e.target.value)}
            aria-label="ラベル"
          >
            <option value="">（ラベルなし）</option>
            {labels.map((lb) => (
              <option key={lb.id} value={lb.id}>
                {lb.name}
              </option>
            ))}
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
