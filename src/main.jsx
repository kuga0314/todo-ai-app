import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import { AuthProvider } from "./hooks/useAuth";
import "./index.css";   // 既存のスタイル

registerSW();

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
