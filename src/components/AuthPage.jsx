// src/components/AuthPage.jsx
import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import "./AuthPage.css";

const AuthPage = () => {
  const { login, register } = useAuth();
  const [email, setEmail]   = useState("");
  const [pw, setPw]         = useState("");
  const [isLogin, setMode]  = useState(true);

  const submit = async () => {
    try {
      if (isLogin) {
        await login(email, pw);
      } else {
        await register(email, pw);
        alert("登録が完了しました。続けてログインします。");
      }
    } catch (e) {
      console.error(e);
      const code = e.code || "auth/error";
      const msg  = e.message || "Authentication error";
      alert(`${code}\n${msg}`);
    }
  };

  return (
    <main className="auth-main">
      <div className="auth-card">
        <h2 className="auth-title">{isLogin ? "ログイン" : "新規登録"}</h2>
        <p className="auth-sub">アカウント情報を入力してください</p>

        <div className="auth-field">
          <label>メールアドレス</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>

        <div className="auth-field">
          <label>パスワード</label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>

        <button className="auth-btn" onClick={submit}>
          {isLogin ? "ログイン" : "登録"}
        </button>

        <p
          className="auth-switch"
          onClick={() => setMode(!isLogin)}
        >
          {isLogin ? "新規登録はこちら" : "ログインはこちら"}
        </p>
      </div>
    </main>
  );
};

export default AuthPage;
