import { useEffect, useState } from "react";
import { apiRequest, AUTH_API_BASE, cleanupLegacyApiBaseUrl, isHiddenAdminRoute } from "./authSession.js";

export default function LoginScreen({ onLogin }) {
  const [adminMode, setAdminMode] = useState(isHiddenAdminRoute);
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    cleanupLegacyApiBaseUrl();
    setAdminMode(isHiddenAdminRoute());
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedUser = username.trim();
    if (!adminMode && trimmedUser.length < 2) {
      setMessage("Isi username dulu minimal 2 karakter.");
      setIsError(true);
      return;
    }
    if (adminMode && !accessCode.trim()) {
      setMessage("Isi kode akses dulu.");
      setIsError(true);
      return;
    }

    setBusy(true);
    setMessage("");
    setIsError(false);

    try {
      const endpoint = adminMode ? `${AUTH_API_BASE}/admin-login` : `${AUTH_API_BASE}/user-login`;
      const payload = adminMode ? { code: accessCode.trim() } : { username: trimmedUser };

      const { response, data } = await apiRequest(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !data?.ok || !data?.session?.token) {
        throw new Error(data?.message || "Login gagal. Coba lagi sebentar.");
      }

      onLogin(data.session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login gagal.");
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-page ws-auth-page">
      <main className="ws-auth-shell">
        <section className="ws-auth-card">
          <div className="ws-auth-logo" aria-hidden="true">
            W
          </div>

          <div className="ws-auth-heading">
            <span className="ws-chip">WHISKY STUDIO</span>
            <h1>{adminMode ? "Ruang Pemantauan" : "Upload Lagu Roblox"}</h1>
            <p className="ws-auth-sub">
              {adminMode
                ? "Masukkan kode akses untuk melanjutkan."
                : "Masuk pakai username, langsung upload. Tanpa password."}
            </p>
          </div>

          <form className="ws-auth-form" onSubmit={handleSubmit}>
            {adminMode ? (
              <div className="ws-fieldbox">
                <label htmlFor="login-access-code">Kode Akses</label>
                <input
                  id="login-access-code"
                  className="ws-input ws-input-super"
                  type="password"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="••••••••••"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            ) : (
              <div className="ws-fieldbox">
                <label htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  className="ws-input ws-input-super"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="contoh: whisky01"
                  autoComplete="username"
                  autoCapitalize="none"
                  maxLength={32}
                  autoFocus
                />
                <small>Username ini yang tercatat di riwayat upload lagu kamu.</small>
              </div>
            )}

            <button type="submit" className="ws-primary ws-auth-submit" disabled={busy}>
              {busy ? "Memproses..." : adminMode ? "Masuk" : "Mulai Upload"}
            </button>

            {message && <div className={isError ? "ws-auth-msg error" : "ws-auth-msg"}>{message}</div>}
          </form>

          <p className="ws-auth-foot">Sesi aktif 30 hari di perangkat ini.</p>
        </section>
      </main>
    </div>
  );
}
