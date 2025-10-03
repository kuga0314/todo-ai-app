// src/components/TodoInput.jsx
import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";

export default function TodoInput({ labels = [] }) {
  const { user } = useAuth();

  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [time, setTime] = useState("18:00");
  const [estimatedMinutes, setEstimatedMinutes] = useState("90");
  const [labelId, setLabelId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user || saving) return;
    if (!text.trim()) {
      alert("タスク名を入力してください");
      return;
    }
    const E = Math.round(Number(estimatedMinutes));
    if (!Number.isFinite(E) || E <= 0) {
      alert("E（見積分）は正の数で入力してください。");
      return;
    }
    if (!deadline) {
      alert("締切日を選んでください");
      return;
    }

    // deadline + time を Date に変換
    const [hh, mm] = (time || "00:00").split(":").map((s) => parseInt(s, 10) || 0);
    const d = new Date(deadline);
    d.setHours(hh, mm, 0, 0);

    try {
      setSaving(true);
      await addDoc(collection(db, "todos"), {
        text: text.trim(),
        deadline: d,
        estimatedMinutes: E,
        labelId: labelId || null,
        actualTotalMinutes: 0,
        completed: false,
        createdAt: serverTimestamp(),
        uid: user.uid,
      });
      setText("");
      setDeadline("");
      setTime("18:00");
      setEstimatedMinutes("90");
      setLabelId("");
    } catch (err) {
      console.error("add todo failed:", err);
      alert("追加に失敗しました。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 8 }}>
      <input
        type="text"
        placeholder="やること"
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        style={{ padding: 8 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          required
          style={{ padding: 8, flex: 1 }}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
          style={{ padding: 8, width: 140 }}
        />
      </div>
      <input
        type="number"
        min="1"
        step="1"
        placeholder="E（見積分）"
        value={estimatedMinutes}
        onChange={(e) => setEstimatedMinutes(e.target.value)}
        required
        style={{ padding: 8 }}
      />
      <select
        value={labelId}
        onChange={(e) => setLabelId(e.target.value)}
        style={{ padding: 8 }}
      >
        <option value="">（ラベルなし）</option>
        {labels.map((lb) => (
          <option key={lb.id} value={lb.id}>{lb.name}</option>
        ))}
      </select>
      <button type="submit" disabled={saving} style={{ padding: 8 }}>
        {saving ? "追加中…" : "追加"}
      </button>
    </form>
  );
}
