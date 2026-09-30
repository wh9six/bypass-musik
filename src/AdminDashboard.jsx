import { useCallback, useEffect, useMemo, useState } from "react";
import { ADMIN_API_BASE, AUTH_API_BASE, apiRequest, clearStoredSession, ROBLOX_API_BASE } from "./authSession.js";

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function studioPreviewName(sample, suffix = "", uppercase = true) {
  let base = String(sample || "Sound").trim();
  let trimmedSuffix = String(suffix || "").trim();
  if (trimmedSuffix) {
    if (!/^[-|_]/.test(trimmedSuffix)) trimmedSuffix = `- ${trimmedSuffix}`;
    base = `${base} ${trimmedSuffix}`.trim();
  }
  return uppercase ? base.toUpperCase() : base;
}

function studioDraftFrom(settings = {}) {
  return {
    studioPlaybackSpeed: String(settings.studioPlaybackSpeed ?? "0.43"),
    studioTargetService: settings.studioTargetService || "SoundService",
    studioFolderName: settings.studioFolderName || "BypassSounds",
    nameSuffix: settings.nameSuffix ?? "",
    autoUppercase: Boolean(settings.autoUppercase),
    roundLabel: settings.roundLabel ?? "",
    processingMode: settings.processingMode === "ori" ? "ori" : "custom",
    changeSpeedValue: String(settings.changeSpeedValue ?? ""),
    exportOggQuality: String(settings.exportOggQuality ?? ""),
    ampDb: String(settings.ampDb ?? ""),
  };
}

export default function AdminDashboard({ session, onLogout }) {
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [historyUser, setHistoryUser] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");

  const [health, setHealth] = useState(null);
  const [apiKeyStatus, setApiKeyStatus] = useState(null);
  const [newApiKey, setNewApiKey] = useState("");
  const [apiKeyLoading, setApiKeyLoading] = useState(false);

  const [studio, setStudio] = useState(null);
  const [studioDraft, setStudioDraft] = useState({
    studioPlaybackSpeed: "0.43",
    studioTargetService: "SoundService",
    studioFolderName: "BypassSounds",
    nameSuffix: "- BKB",
    autoUppercase: true,
    roundLabel: "",
    processingMode: "custom",
    changeSpeedValue: "2.325581",
    exportOggQuality: "8",
    ampDb: "-2",
  });
  const [studioSaving, setStudioSaving] = useState(false);

  const [cookieInfo, setCookieInfo] = useState(null);
  const [cookieDraft, setCookieDraft] = useState("");
  const [cookieSaving, setCookieSaving] = useState(false);
  const [diagnoseUrl, setDiagnoseUrl] = useState("");
  const [diagnoseRunning, setDiagnoseRunning] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState(null);
  const [diagnoseError, setDiagnoseError] = useState("");

  const [statusText, setStatusText] = useState("Mode admin: pantau upload user, atur API key, dan pengaturan studio.");
  const [statusTone, setStatusTone] = useState("idle");

  function report(ok, message) {
    setStatusText(message);
    setStatusTone(ok ? "success" : "error");
  }

  async function handleLogout() {
    try {
      await apiRequest(`${AUTH_API_BASE}/logout`, { method: "POST" });
    } catch {
      // ignore logout network failure
    }
    clearStoredSession();
    onLogout();
  }

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const { response, data } = await apiRequest(`${ADMIN_API_BASE}/overview`);
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal mengambil data admin.");
      setOverview(data);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Gagal mengambil data admin.");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadApiKeyStatus = useCallback(async () => {
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/api-key`);
      if (!response.ok || !data?.ok) return;
      setApiKeyStatus(data);
    } catch {
      setApiKeyStatus(null);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/health`);
      if (!response.ok || !data?.ok) return;
      setHealth(data);
    } catch {
      setHealth(null);
    }
  }, []);

  const loadStudioSettings = useCallback(async () => {
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/studio`);
      if (!response.ok || !data?.ok || !data.settings) return;
      setStudio(data.settings);
      setStudioDraft(studioDraftFrom(data.settings));
    } catch {
      // status tetap tampil dari health/api-key
    }
  }, []);

  const loadCookieStatus = useCallback(async () => {
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/cookies`);
      if (!response.ok || !data?.ok) return;
      setCookieInfo(data);
    } catch {
      setCookieInfo(null);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");

    const params = new URLSearchParams({ limit: "500" });
    if (historyDate) params.set("date", historyDate);
    if (historyUser) params.set("username", historyUser);

    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/upload-history?${params.toString()}`);
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal mengambil riwayat upload user.");
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setHistory([]);
      setHistoryError(error instanceof Error ? error.message : "Gagal mengambil riwayat upload user.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyDate, historyUser]);

  useEffect(() => {
    loadOverview();
    loadApiKeyStatus();
    loadHealth();
    loadStudioSettings();
    loadCookieStatus();
    loadHistory();
  }, [loadOverview, loadApiKeyStatus, loadHealth, loadStudioSettings, loadCookieStatus, loadHistory]);

  const filteredHistory = useMemo(() => {
    const keyword = historyQuery.trim().toLowerCase();
    if (!keyword) return history;
    return history.filter((item) => {
      const haystack = [item?.username, item?.uploadRecordId, item?.uploadedName, item?.assetId, item?.operationId, item?.sourceName, item?.batchLabel]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(keyword);
    });
  }, [history, historyQuery]);

  async function saveApiKey() {
    const key = newApiKey.trim();
    if (!key) {
      report(false, "Isi API key Roblox dulu.");
      return;
    }

    setApiKeyLoading(true);
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ robloxApiKey: key }),
      });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal menyimpan API key Roblox.");
      setNewApiKey("");
      report(true, data?.message || "API key Roblox berhasil disimpan.");
      await Promise.all([loadApiKeyStatus(), loadHealth(), loadOverview()]);
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal menyimpan API key Roblox.");
    } finally {
      setApiKeyLoading(false);
    }
  }

  async function deleteApiKey() {
    setApiKeyLoading(true);
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/api-key`, { method: "DELETE" });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal menghapus API key Roblox.");
      report(true, data?.message || "API key Roblox berhasil dihapus.");
      await Promise.all([loadApiKeyStatus(), loadHealth()]);
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal menghapus API key Roblox.");
    } finally {
      setApiKeyLoading(false);
    }
  }

  function updateStudioDraft(key, value) {
    setStudioDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function saveStudio() {
    setStudioSaving(true);
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/studio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(studioDraft),
      });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal menyimpan pengaturan studio.");
      setStudio(data.settings);
      setStudioDraft(studioDraftFrom(data.settings));
      report(true, data?.message || "Pengaturan studio & nama sound berhasil disimpan.");
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal menyimpan pengaturan studio.");
    } finally {
      setStudioSaving(false);
    }
  }

  async function saveCookies() {
    const text = cookieDraft.trim();
    if (!text) {
      report(false, "Tempel dulu isi cookies.json-nya.");
      return;
    }

    setCookieSaving(true);
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: text }),
      });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal menyimpan cookies YouTube.");
      setCookieDraft("");
      setCookieInfo(data);
      report(true, data?.message || "Cookies YouTube tersimpan.");
      await Promise.all([loadCookieStatus(), loadHealth()]);
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal menyimpan cookies YouTube.");
    } finally {
      setCookieSaving(false);
    }
  }

  async function deleteCookies() {
    if (!window.confirm("Hapus file cookies YouTube dari server?")) return;
    setCookieSaving(true);
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/settings/cookies`, { method: "DELETE" });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal menghapus cookies YouTube.");
      report(true, data?.message || "Cookies YouTube dihapus.");
      await Promise.all([loadCookieStatus(), loadHealth()]);
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal menghapus cookies YouTube.");
    } finally {
      setCookieSaving(false);
    }
  }

  async function runYouTubeDiagnose() {
    setDiagnoseRunning(true);
    setDiagnoseError("");
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/diagnose/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: diagnoseUrl.trim() }),
      });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Diagnosis YouTube gagal.");
      setDiagnoseResult(data);
    } catch (error) {
      setDiagnoseResult(null);
      setDiagnoseError(error instanceof Error ? error.message : "Diagnosis YouTube gagal.");
    } finally {
      setDiagnoseRunning(false);
    }
  }

  async function deleteHistoryItem(recordId, name) {
    if (!window.confirm(`Hapus rekaman #${recordId} (${name || "tanpa nama"}) dari riwayat?`)) return;
    setHistoryLoading(true);
    try {
      const { response, data } = await apiRequest(`${ROBLOX_API_BASE}/upload-history/${recordId}`, { method: "DELETE" });
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal menghapus rekaman riwayat.");
      report(true, data?.message || "Rekaman riwayat berhasil dihapus.");
      await Promise.all([loadHistory(), loadOverview()]);
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal menghapus rekaman riwayat.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function clearUserHistory(usernameKey, label) {
    if (!window.confirm(`Hapus SEMUA riwayat upload milik user '${label}'?`)) return;
    setHistoryLoading(true);
    try {
      const { response, data } = await apiRequest(
        `${ROBLOX_API_BASE}/upload-history?username=${encodeURIComponent(usernameKey)}`,
        { method: "DELETE" }
      );
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Gagal membersihkan riwayat user.");
      report(true, data?.message || "Riwayat user berhasil dibersihkan.");
      await Promise.all([loadHistory(), loadOverview()]);
    } catch (error) {
      report(false, error instanceof Error ? error.message : "Gagal membersihkan riwayat user.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function exportHistoryCsv() {
    if (!filteredHistory.length) {
      report(false, "Tidak ada data riwayat untuk diexport.");
      return;
    }

    const headers = ["uploadRecordId", "username", "uploadDate", "uploadedAt", "uploadedName", "assetId", "sourceType", "sourceUrl", "batchLabel"];
    const rows = filteredHistory.map((item) =>
      headers
        .map((key) => {
          const value = String(item?.[key] ?? "").replace(/"/g, '""');
          return `"${value}"`;
        })
        .join(",")
    );

    const blob = new Blob([`${headers.join(",")}\n${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `admin-upload-history-${historyDate || "all"}.csv`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    report(true, `Export ${rows.length} baris riwayat berhasil.`);
  }

  const totals = overview?.totals || {};
  const users = overview?.users || [];
  const daily = overview?.daily || [];
  const userLabelByKey = useMemo(() => {
    const map = new Map();
    for (const user of users) {
      if (user.usernameKey) map.set(user.usernameKey, user.username);
    }
    return map;
  }, [users]);
  const creatorProfile = health?.creatorProfile || apiKeyStatus?.creatorProfile || null;
  const hasApiKey = typeof apiKeyStatus?.hasApiKey === "boolean" ? apiKeyStatus.hasApiKey : Boolean(health?.hasApiKey);

  return (
    <div className="ws-page">
      <main className="ws-shell">
        <header className="ws-hero">
          <div className="ws-brand-row">
            <span className="ws-chip ws-chip-soft">MODE ADMIN</span>
            <span className="ws-chip ws-chip-owner">Login: {session?.username || "admin"}</span>
            <button type="button" className="ws-mini-btn ws-topbar-logout" onClick={handleLogout}>
              🚪 Keluar
            </button>
          </div>

          <h1>Dashboard Pemantauan User</h1>
          <p>
            Lihat user mana yang upload lagu apa saja, atur API key Roblox, dan tentukan pengaturan nama sound
            serta script Studio yang dipakai semua user.
          </p>

          <div className="ws-kpi-grid">
            <article className="ws-kpi">
              <small>Total Upload Tercatat</small>
              <strong>{totals.historyRecords ?? "-"}</strong>
            </article>
            <article className="ws-kpi">
              <small>Daftar User</small>
              <strong>{totals.users ?? "-"}</strong>
            </article>
            <article className="ws-kpi">
              <small>Upload Hari Ini</small>
              <strong>{totals.todayUploads ?? "-"} ({totals.todayDate || todayKey()})</strong>
            </article>
            <article className="ws-kpi">
              <small>API Key</small>
              <strong>{hasApiKey ? `Aktif (${apiKeyStatus?.maskedKey || "env"})` : "Belum dipasang"}</strong>
            </article>
          </div>

          {daily.length > 0 && (
            <div className="ws-admin-daily">
              <small>14 hari terakhir</small>
              <div className="ws-admin-daily-row">
                {daily.slice(0, 10).map((entry) => (
                  <span key={entry.date} className="ws-admin-daily-chip">
                    {entry.date.slice(5)} <b>{entry.count}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </header>

        <div className="ws-grid">
          <section className="ws-card">
            <div className="ws-section-head">
              <strong>User &amp; Aktivitas Upload</strong>
              <span>{overviewLoading ? "Memuat..." : `${users.length} user`}</span>
            </div>

            {overviewError && <div className="ws-alert">{overviewError}</div>}

            <div className="ws-admin-table-wrap">
              <table className="ws-admin-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Total</th>
                    <th>Hari ini</th>
                    <th>Hari aktif</th>
                    <th>Upload terakhir</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="ws-admin-empty">
                        Belum ada user yang login.
                      </td>
                    </tr>
                  )}
                  {users.map((user) => (
                    <tr key={user.usernameKey || user.username}>
                      <td data-label="Username">
                        <b>{user.username}</b>
                        {user.lastLoginAt && <small className="ws-admin-sub">login: {formatDateTime(user.lastLoginAt)}</small>}
                      </td>
                      <td data-label="Total">{user.totalUploads}</td>
                      <td data-label="Hari ini">{user.todayUploads}</td>
                      <td data-label="Hari aktif">{user.activeDays}</td>
                      <td data-label="Upload terakhir">
                        {user.lastUploadAt ? formatDateTime(user.lastUploadAt) : "-"}
                        {user.lastUploadName && <small className="ws-admin-sub">{user.lastUploadName}</small>}
                      </td>
                      <td className="ws-admin-cell-actions" data-label="Aksi">
                        <button type="button" className="ws-mini-btn" onClick={() => setHistoryUser(user.usernameKey)}>
                          Lihat log
                        </button>
                        {user.totalUploads > 0 && (
                          <button
                            type="button"
                            className="ws-mini-btn ws-mini-btn-danger"
                            onClick={() => clearUserHistory(user.usernameKey, user.username)}
                          >
                            🗑️ Riwayat
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ws-card ws-side-card">
            <div className="ws-section-head">
              <strong>API Key Roblox</strong>
              <span>khusus admin</span>
            </div>

            <div className={`ws-status ${statusTone}`}>
              <small>Status terbaru</small>
              <p>{statusText}</p>
            </div>

            {hasApiKey ? (
              <div className="ws-key-ready">
                <small>
                  {apiKeyStatus
                    ? `API key aktif | Source: ${apiKeyStatus.source || "-"} | Masked: ${apiKeyStatus.maskedKey || "-"}`
                    : "API key aktif di backend."}
                </small>
                <div className="ws-admin-actions">
                  <button type="button" className="ws-outline" onClick={loadApiKeyStatus} disabled={apiKeyLoading}>
                    Cek Ulang
                  </button>
                  <button type="button" className="ws-outline ws-danger" onClick={deleteApiKey} disabled={apiKeyLoading}>
                    Hapus API Key
                  </button>
                </div>
              </div>
            ) : (
              <div className="ws-fieldbox">
                <label htmlFor="admin-api-key">Pasang API Key</label>
                <input
                  id="admin-api-key"
                  className="ws-input"
                  type="password"
                  value={newApiKey}
                  onChange={(event) => setNewApiKey(event.target.value)}
                  placeholder="Masukkan ROBLOX_API_KEY"
                />
                <div className="ws-admin-actions">
                  <button type="button" className="ws-primary" onClick={saveApiKey} disabled={apiKeyLoading}>
                    {apiKeyLoading ? "Menyimpan..." : "Simpan API Key"}
                  </button>
                </div>
                <small>Key disimpan di backend (file roblox-api-key.json), tidak pernah dipegang user.</small>
              </div>
            )}

            <div className="ws-creator-profile">
              <strong>Profil Creator</strong>
              {creatorProfile ? (
                <div className="ws-creator-profile-card">
                  {creatorProfile.avatarUrl ? (
                    <img src={creatorProfile.avatarUrl} alt={`Avatar ${creatorProfile.displayName || creatorProfile.name}`} className="ws-avatar" />
                  ) : (
                    <div className="ws-avatar ws-avatar-fallback">{String(creatorProfile.displayName || creatorProfile.name || "W").slice(0, 1)}</div>
                  )}
                  <div className="ws-creator-profile-meta">
                    <b>{creatorProfile.displayName || creatorProfile.name || "-"}</b>
                    <small>{creatorProfile.type === "group" ? "Group" : "User"} ID: {creatorProfile.id || "-"}</small>
                  </div>
                </div>
              ) : (
                <small>Profil creator belum kebaca. Pasang API key dulu.</small>
              )}
            </div>

            <div className="ws-admin-panel">
              <div className="ws-section-head">
                <strong>Pengaturan Studio &amp; Audio</strong>
                <span>pakai untuk semua user</span>
              </div>

              <div className="ws-admin-field-row">
                <div className="ws-inline-field">
                  <label htmlFor="studio-speed">PlaybackSpeed</label>
                  <input
                    id="studio-speed"
                    className="ws-input"
                    type="number"
                    step="0.001"
                    value={studioDraft.studioPlaybackSpeed}
                    onChange={(event) => updateStudioDraft("studioPlaybackSpeed", event.target.value)}
                    placeholder="0.43"
                  />
                </div>
                <div className="ws-inline-field">
                  <label htmlFor="studio-service">Target Service</label>
                  <select
                    id="studio-service"
                    className="ws-input ws-select"
                    value={studioDraft.studioTargetService}
                    onChange={(event) => updateStudioDraft("studioTargetService", event.target.value)}
                  >
                    <option value="SoundService">SoundService</option>
                    <option value="Workspace">Workspace</option>
                    <option value="ReplicatedStorage">ReplicatedStorage</option>
                  </select>
                </div>
                <div className="ws-inline-field">
                  <label htmlFor="studio-folder">Nama Folder</label>
                  <input
                    id="studio-folder"
                    className="ws-input"
                    value={studioDraft.studioFolderName}
                    onChange={(event) => updateStudioDraft("studioFolderName", event.target.value)}
                    placeholder="BypassSounds"
                  />
                </div>
              </div>

              <div className="ws-inline-field">
                <label htmlFor="studio-suffix">Tag / Akhiran Nama Sound</label>
                <input
                  id="studio-suffix"
                  className="ws-input"
                  value={studioDraft.nameSuffix}
                  onChange={(event) => updateStudioDraft("nameSuffix", event.target.value)}
                  placeholder="- BKB / - REMIX / kosongkan untuk tanpa tag"
                  maxLength={24}
                />
                <div className="ws-preset-tags">
                  {["", "- BKB", "- REMIX", "- SLOWED", "- VIP"].map((tag) => (
                    <button
                      key={tag || "tanpa-tag"}
                      type="button"
                      className={`ws-tag-btn ${studioDraft.nameSuffix === tag ? "active" : ""}`}
                      onClick={() => updateStudioDraft("nameSuffix", tag)}
                    >
                      {tag || "Tanpa Tag"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ws-inline-field">
                <label htmlFor="studio-round">Label Ronde Default (opsional)</label>
                <input
                  id="studio-round"
                  className="ws-input"
                  value={studioDraft.roundLabel}
                  onChange={(event) => updateStudioDraft("roundLabel", event.target.value)}
                  placeholder="Kosong = otomatis Ronde 1, Ronde 2"
                  maxLength={40}
                />
              </div>

              <div className="ws-inline-field">
                <label>Mode Pengolahan Audio</label>
                <div className="ws-toggle-row">
                  <button
                    type="button"
                    className={`ws-tag-btn ${studioDraft.processingMode === "custom" ? "active" : ""}`}
                    onClick={() => updateStudioDraft("processingMode", "custom")}
                  >
                    Custom
                  </button>
                  <button
                    type="button"
                    className={`ws-tag-btn ${studioDraft.processingMode === "ori" ? "active" : ""}`}
                    onClick={() => updateStudioDraft("processingMode", "ori")}
                  >
                    Ori
                  </button>
                </div>
                <small>User tidak bisa mengubah ini, jadi audio mereka selalu diproses dengan setting yang sama.</small>
              </div>

              <div className="ws-admin-field-row">
                <div className="ws-inline-field">
                  <label htmlFor="audio-speed">Change speed value</label>
                  <input
                    id="audio-speed"
                    className="ws-input"
                    type="number"
                    step="0.000001"
                    min="0.25"
                    max="8"
                    value={studioDraft.changeSpeedValue}
                    onChange={(event) => updateStudioDraft("changeSpeedValue", event.target.value)}
                  />
                </div>
                <div className="ws-inline-field">
                  <label htmlFor="audio-ogg">Export OGG quality</label>
                  <input
                    id="audio-ogg"
                    className="ws-input"
                    type="number"
                    step="1"
                    min="0"
                    max="10"
                    value={studioDraft.exportOggQuality}
                    onChange={(event) => updateStudioDraft("exportOggQuality", event.target.value)}
                  />
                </div>
                <div className="ws-inline-field">
                  <label htmlFor="audio-amp">Amp (dB)</label>
                  <input
                    id="audio-amp"
                    className="ws-input"
                    type="number"
                    step="0.1"
                    min="-30"
                    max="12"
                    value={studioDraft.ampDb}
                    onChange={(event) => updateStudioDraft("ampDb", event.target.value)}
                  />
                </div>
              </div>

              <label className="ws-checkbox ws-checkbox-compact" htmlFor="studio-uppercase">
                <input
                  id="studio-uppercase"
                  type="checkbox"
                  checked={studioDraft.autoUppercase}
                  onChange={(event) => updateStudioDraft("autoUppercase", event.target.checked)}
                />
                <div>
                  <strong>Huruf Kapital Semua</strong>
                  <small>Nama sound di Roblox Studio otomatis UPPERCASE</small>
                </div>
              </label>

              <div className="ws-preview-tag-box">
                <small>Contoh nama sound user:</small>
                <b>{studioPreviewName("32 hari aku sendiri", studioDraft.nameSuffix, studioDraft.autoUppercase)}</b>
              </div>

              <div className="ws-admin-actions">
                <button type="button" className="ws-primary" onClick={saveStudio} disabled={studioSaving}>
                  {studioSaving ? "Menyimpan..." : "Simpan Pengaturan"}
                </button>
                <button type="button" className="ws-outline" onClick={loadStudioSettings} disabled={studioSaving}>
                  Reset Isian
                </button>
              </div>
              {studio ? null : <small>Pengaturan belum kebaca dari server.</small>}
            </div>

            <div className="ws-admin-panel">
              <div className="ws-section-head">
                <strong>Cookies YouTube</strong>
                <span>untuk mode link YouTube</span>
              </div>

              <div className="ws-key-ready">
                <small>
                  {cookieInfo?.status?.enabled
                    ? `Cookies aktif | sumber: ${cookieInfo.status.source || "-"} | jumlah: ${
                        cookieInfo.status.count == null ? "browser" : cookieInfo.status.count
                      } item`
                    : "Cookies belum aktif. Upload dari link YouTube bisa gagal kena blokir 403/429."}
                </small>
                <small>File tersimpan di server: {cookieInfo?.cookieFile || "cookies.json"} (tidak pernah masuk GitHub).</small>
                {health?.youtubeTool && (
                  <small className={health.youtubeTool.exists && !health.youtubeTool.needsPython ? "" : "ws-inline-warning"}>
                    {!health.youtubeTool.exists
                      ? "yt-dlp belum terunduh di server, jadi link yang gagal lewat ytdl-core pasti ikut gagal (perbaiki: npm install ulang atau node scripts/fetch-yt-dlp.mjs)."
                      : health.youtubeTool.needsPython
                        ? "yt-dlp di server ini versi script (butuh python3). Unduh ulang yang standalone: node scripts/fetch-yt-dlp.mjs --force"
                        : `yt-dlp siap: ${health.youtubeTool.name} (standalone, tidak butuh Python)${
                            health.youtubeTool.version ? ` v${health.youtubeTool.version}` : ""
                          }${
                            health.youtubeTool.playerClients && health.youtubeTool.playerClients !== "auto"
                              ? ` | player dipaksa: ${health.youtubeTool.playerClients}`
                              : ""
                          }.`}
                  </small>
                )}
                {cookieInfo?.usesEnvJson && (
                  <small className="ws-inline-warning">
                    Variables YTDL_COOKIES_JSON sedang terisi, jadi cookies dari variabel itu yang dipakai lebih dulu.
                  </small>
                )}
              </div>

              <div className="ws-inline-field">
                <label htmlFor="cookie-paste">Tempel isi cookies.json</label>
                <textarea
                  id="cookie-paste"
                  className="ws-input ws-textarea"
                  value={cookieDraft}
                  onChange={(event) => setCookieDraft(event.target.value)}
                  placeholder='[{"name":"__Secure-3PAPISID","value":"...","domain":".youtube.com"}]'
                  spellCheck={false}
                />
                <small>Format array objek berisi minimal <b>name</b> dan <b>value</b>. Bisa juga hasil ekspor ekstensi cookie.</small>
              </div>

              <div className="ws-admin-actions">
                <button type="button" className="ws-primary" onClick={saveCookies} disabled={cookieSaving}>
                  {cookieSaving ? "Menyimpan..." : "Simpan Cookies"}
                </button>
                <button
                  type="button"
                  className="ws-outline ws-outline-danger"
                  onClick={deleteCookies}
                  disabled={cookieSaving || !cookieInfo?.savedCount}
                >
                  Hapus Cookies
                </button>
              </div>
            </div>

            <div className="ws-admin-panel">
              <div className="ws-section-head">
                <strong>Diagnosis Link YouTube</strong>
                <span>server mencoba semua kombinasi player</span>
              </div>

              <div className="ws-inline-field">
                <label htmlFor="diagnose-url">Link YouTube untuk dicek (kosong = video tes bawaan)</label>
                <input
                  id="diagnose-url"
                  className="ws-input"
                  value={diagnoseUrl}
                  onChange={(event) => setDiagnoseUrl(event.target.value)}
                  placeholder="https://youtu.be/..."
                />
                <small>
                  Tidak ada file yang diunduh maupun diupload ke Roblox, jadi aman untuk mengetes tanpa
                  membebani akun. Kalau semua kombinasi gagal, berarti IP server yang diblokir YouTube.
                </small>
              </div>

              <div className="ws-admin-actions">
                <button type="button" className="ws-primary" onClick={runYouTubeDiagnose} disabled={diagnoseRunning}>
                  {diagnoseRunning ? "Menguji..." : "Jalankan Diagnosis"}
                </button>
              </div>

              {diagnoseError ? <small className="ws-inline-warning">{diagnoseError}</small> : null}

              {diagnoseResult ? (
                <div className="ws-preview-tag-box">
                  <small>
                    yt-dlp: {diagnoseResult.binary} | cookie terbaca: {diagnoseResult.cookieCount} item | player:{" "}
                    {diagnoseResult.playerClientConfig === "auto" ? "otomatis" : diagnoseResult.playerClientConfig}
                  </small>
                  {(diagnoseResult.results || []).map((item) => (
                    <small key={item.label} className={item.ok ? "" : "ws-inline-warning"}>
                      {item.ok ? "✓" : "✗"} {item.label} ({item.ms}ms) {item.ok ? "" : ` -> ${item.detail}`}
                    </small>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="ws-admin-actions">
              <button type="button" className="ws-outline" onClick={() => { loadOverview(); loadHistory(); }}>
                🔄 Refresh Data
              </button>
            </div>
          </section>
        </div>

        <section className="ws-card">
          <div className="ws-section-head">
            <strong>Log Upload Semua User</strong>
            <span>{historyLoading ? "Memuat..." : `${filteredHistory.length} rekaman`}</span>
          </div>

          <div className="ws-admin-filters">
            <div className="ws-inline-field">
              <label htmlFor="admin-history-date">Tanggal</label>
              <input
                id="admin-history-date"
                className="ws-input"
                type="date"
                value={historyDate}
                onChange={(event) => setHistoryDate(event.target.value)}
              />
            </div>
            <div className="ws-inline-field">
              <label htmlFor="admin-history-user">User</label>
              <select
                id="admin-history-user"
                className="ws-input ws-select"
                value={historyUser}
                onChange={(event) => setHistoryUser(event.target.value)}
              >
                <option value="">Semua user</option>
                {users.map((user) => (
                  <option key={user.usernameKey || user.username} value={user.usernameKey}>
                    {userLabelByKey.get(user.usernameKey) || user.username} ({user.totalUploads})
                  </option>
                ))}
              </select>
            </div>
            <div className="ws-inline-field">
              <label htmlFor="admin-history-query">Cari</label>
              <input
                id="admin-history-query"
                className="ws-input"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="nama lagu / asset id / user"
              />
            </div>
          </div>

          <div className="ws-admin-actions">
            <button type="button" className="ws-outline" onClick={loadHistory} disabled={historyLoading}>
              {historyLoading ? "Mengambil data..." : "Ambil Log"}
            </button>
            <button type="button" className="ws-outline" onClick={exportHistoryCsv} disabled={!filteredHistory.length}>
              Export CSV
            </button>
            {(historyDate || historyUser) && (
              <button
                type="button"
                className="ws-outline"
                onClick={() => {
                  setHistoryDate("");
                  setHistoryUser("");
                }}
              >
                Reset Filter
              </button>
            )}
          </div>

          {historyError && <div className="ws-alert">{historyError}</div>}

          {filteredHistory.length > 0 ? (
            <div className="ws-admin-table-wrap">
              <table className="ws-admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>User</th>
                    <th>Waktu</th>
                    <th>Nama Lagu</th>
                    <th>Asset ID</th>
                    <th>Sumber</th>
                    <th>Ronde</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((item) => (
                    <tr key={`${item.uploadRecordId}-${item.assetId || item.operationId || "no-id"}`}>
                      <td data-label="#">{item.uploadRecordId}</td>
                      <td data-label="User">{item.username || userLabelByKey.get(String(item.usernameKey || "")) || "(belum tercatat)"}</td>
                      <td data-label="Waktu">{formatDateTime(item.uploadedAt)}</td>
                      <td data-label="Nama Lagu">{item.uploadedName || item.sourceName || "-"}</td>
                      <td data-label="Asset ID">{item.assetId || "menunggu..."}</td>
                      <td data-label="Sumber">{item.sourceType === "url" ? "URL" : item.sourceType === "file" ? "File" : item.sourceType || "-"}</td>
                      <td data-label="Ronde">{item.batchLabel || item.batchId || "-"}</td>
                      <td className="ws-admin-cell-actions" data-label="Aksi">
                        {item.assetId && (
                          <button
                            type="button"
                            className="ws-mini-btn"
                            onClick={() => navigator.clipboard?.writeText(String(item.assetId))}
                          >
                            Copy ID
                          </button>
                        )}
                        <button
                          type="button"
                          className="ws-mini-btn ws-mini-btn-danger"
                          onClick={() => deleteHistoryItem(item.uploadRecordId, item.uploadedName || item.sourceName)}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <small>{historyLoading ? "Memuat log upload..." : "Belum ada upload yang cocok dengan filter."}</small>
          )}
        </section>
      </main>
    </div>
  );
}
