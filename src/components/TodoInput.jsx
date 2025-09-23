// src/components/TodoInput.jsx
import { useState, useEffect } from "react";
import { collection, addDoc, Timestamp, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";
import "./TodoInput.css";

export default function TodoInput() {
  const { user } = useAuth();

  // 入力フィールド
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [scale, setScale] = useState(3); // 不確実性レベル 1..5
  const [priority, setPriority] = useState(2);
  const [estimatedMinutes, setEstimatedMinutes] = useState(""); // M（分）必須
  const [Omin, setOmin] = useState(""); // 任意 O（分）
  const [Pmin, setPmin] = useState(""); // 任意 P（分）
  const [saving, setSaving] = useState(false);

  // ラベル（使っていなければセクションごと削ってもOK）
  const [labels, setLabels] = useState([]);
  const [selectedLabelId, setSelectedLabelId] = useState("");

  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, "users", user.uid, "labels");
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() ?? {}) }));
      setLabels(rows);
      // 既存選択が消えていたら解除
      if (rows.findIndex((r) => r.id === selectedLabelId) === -1) {
        setSelectedLabelId("");
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const reset = () => {
    setText("");
    setDeadline("");
    setScale(3);
    setPriority(2);
    setEstimatedMinutes("");
    setOmin("");
    setPmin("");
    setSelectedLabelId("");
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!user || !text.trim() || saving) return;

    // M は必須
    const M = Number(estimatedMinutes);
    if (!Number.isFinite(M) || M <= 0) {
      alert("所要時間（M, 分）を正の数で入力してください。");
      return;
    }

    // O/P は任意。与えられていれば妥当性チェック
    let O = Omin === "" ? null : Math.round(Number(Omin));
    let P = Pmin === "" ? null : Math.round(Number(Pmin));
    if (O != null && (!Number.isFinite(O) || O <= 0)) {
      alert("O（楽観・分）は正の数で入力してください。");
      return;
    }
    if (P != null && (!Number.isFinite(P) || P <= 0)) {
      alert("P（悲観・分）は正の数で入力してください。");
      return;
    }
    if (O != null && P != null && P <= O) {
      alert("P は O より大きい必要があります。");
      return;
    }

    setSaving(true);
    try {
      const deadlineTS = deadline ? Timestamp.fromDate(new Date(deadline)) : null;

      await addDoc(collection(db, "todos"), {
        userId: user.uid,
        text: text.trim(),
        completed: false,
        deadline: deadlineTS,
        scale,
        priority,
        estimatedMinutes: Math.round(M), // M（必須）
        O: O ?? null,                    // 任意（未入力なら保存しない＝null）
        P: P ?? null,                    // 任意（未入力なら保存しない＝null）
        labelId: selectedLabelId || null,
        notified: false,
        createdAt: Timestamp.now(),
      });

      reset();
    } catch (err) {
      console.error("add todo failed:", err);
      alert("追加に失敗しました。もう一度お試しください。");
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

      {/* 下段：締切・規模・優先度・ラベル・M/O/P・追加 */}
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
          不確実性
          <select
            className="ti-select"
            value={scale}
            onChange={(e) => setScale(+e.target.value)}
            aria-label="不確実性"
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
          ラベル
          <select
            className="ti-select"
            value={selectedLabelId}
            onChange={(e) => setSelectedLabelId(e.target.value)}
            aria-label="ラベル"
          >
            <option value="">（ラベルなし）</option>
            {labels.map((lb) => (
              <option key={lb.id} value={lb.id}>{lb.name}</option>
            ))}
          </select>
        </label>

        <label className="ti-field">
          M（分）*
          <input
            className="ti-number"
            type="number"
            min={1}
            step={1}
            placeholder="例: 90"
            aria-label="M（分）"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            required
          />
        </label>

        <label className="ti-field">
          O（分）
          <input
            className="ti-number"
            type="number"
            min={1}
            step={1}
            placeholder="任意"
            aria-label="O（分）"
            value={Omin}
            onChange={(e) => setOmin(e.target.value)}
          />
        </label>

        <label className="ti-field">
          P（分）
          <input
            className="ti-number"
            type="number"
            min={1}
            step={1}
            placeholder="任意"
            aria-label="P（分）"
            value={Pmin}
            onChange={(e) => setPmin(e.target.value)}
          />
        </label>

        <button className="ti-submit" type="submit" disabled={saving}>
          {saving ? "追加中…" : "＋ 追加"}
        </button>
      </div>
    </form>
  );
}
