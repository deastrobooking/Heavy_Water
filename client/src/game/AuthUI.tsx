import React, { useState } from "react";

interface AuthUIProps {
  onAuthenticated: (user: any) => void;
  onPlayOffline: () => void;
}

export default function AuthUI({ onAuthenticated, onPlayOffline }: AuthUIProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Something went wrong");
        setLoading(false);
        return;
      }
      onAuthenticated(data);
    } catch {
      setError("Connection failed");
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1a2e 100%)",
      fontFamily: "'Courier New', monospace",
      zIndex: 10000,
    }}>
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />

      <div style={{
        position: "relative",
        width: 400,
        padding: 40,
        background: "rgba(0,10,20,0.9)",
        border: "1px solid rgba(0,255,255,0.3)",
        borderRadius: 8,
        boxShadow: "0 0 40px rgba(0,255,255,0.1), inset 0 0 40px rgba(0,0,0,0.5)",
      }}>
        <h1 style={{
          textAlign: "center",
          color: "#00ffff",
          fontSize: 28,
          marginBottom: 4,
          textShadow: "0 0 20px rgba(0,255,255,0.5)",
          letterSpacing: 4,
        }}>HEAVY WATER</h1>
        <p style={{
          textAlign: "center",
          color: "#ff6600",
          fontSize: 12,
          marginBottom: 30,
          letterSpacing: 2,
        }}>THE FIRST ATTACK</p>

        <div style={{ display: "flex", marginBottom: 24, gap: 8 }}>
          <button
            onClick={() => { setMode("login"); setError(""); }}
            style={{
              flex: 1,
              padding: "10px 0",
              background: mode === "login" ? "rgba(0,255,255,0.15)" : "transparent",
              border: `1px solid ${mode === "login" ? "#00ffff" : "rgba(255,255,255,0.2)"}`,
              color: mode === "login" ? "#00ffff" : "#666",
              cursor: "pointer",
              fontSize: 13,
              letterSpacing: 2,
              borderRadius: 4,
            }}
          >LOGIN</button>
          <button
            onClick={() => { setMode("register"); setError(""); }}
            style={{
              flex: 1,
              padding: "10px 0",
              background: mode === "register" ? "rgba(0,255,255,0.15)" : "transparent",
              border: `1px solid ${mode === "register" ? "#00ffff" : "rgba(255,255,255,0.2)"}`,
              color: mode === "register" ? "#00ffff" : "#666",
              cursor: "pointer",
              fontSize: 13,
              letterSpacing: 2,
              borderRadius: 4,
            }}
          >REGISTER</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "#888", fontSize: 11, marginBottom: 6, letterSpacing: 1 }}>
              USERNAME
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(0,255,255,0.05)",
                border: "1px solid rgba(0,255,255,0.2)",
                borderRadius: 4,
                color: "#00ffff",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
              placeholder="Enter callsign..."
              autoFocus
              minLength={3}
              maxLength={20}
              required
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", color: "#888", fontSize: 11, marginBottom: 6, letterSpacing: 1 }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(0,255,255,0.05)",
                border: "1px solid rgba(0,255,255,0.2)",
                borderRadius: 4,
                color: "#00ffff",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
              placeholder="Enter access code..."
              minLength={6}
              required
            />
          </div>

          {error && (
            <div style={{
              padding: "8px 12px",
              background: "rgba(255,0,0,0.1)",
              border: "1px solid rgba(255,0,0,0.3)",
              borderRadius: 4,
              color: "#ff4444",
              fontSize: 12,
              marginBottom: 16,
            }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 0",
              background: loading ? "rgba(0,255,255,0.1)" : "linear-gradient(180deg, rgba(0,255,255,0.2), rgba(0,255,255,0.1))",
              border: "1px solid #00ffff",
              borderRadius: 4,
              color: "#00ffff",
              fontSize: 14,
              letterSpacing: 2,
              cursor: loading ? "wait" : "pointer",
              marginBottom: 16,
            }}
          >
            {loading ? "CONNECTING..." : mode === "login" ? "CONNECT" : "CREATE ACCOUNT"}
          </button>
        </form>

        <button
          onClick={onPlayOffline}
          style={{
            width: "100%",
            padding: "10px 0",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 4,
            color: "#666",
            fontSize: 12,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >PLAY OFFLINE</button>
      </div>
    </div>
  );
}
