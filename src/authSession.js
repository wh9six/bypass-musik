const SESSION_STORAGE_KEY = "whisky_auth_session";
const LEGACY_API_BASE_STORAGE_KEY = "whisky_api_base_url";
const UNAUTHORIZED_EVENT = "whisky:unauthorized";

// Base URL selalu otomatis (same-origin) karena web + API di-deploy di satu server Railway.
// Override hanya lewat build env VITE_API_BASE_URL kalau backend dipisah.
export const ROBLOX_API_BASE = String(import.meta.env.VITE_API_BASE_URL || "/api/roblox").trim().replace(/\/+$/, "");
export const AUTH_API_BASE = `${getBackendRoot(ROBLOX_API_BASE) ?? ""}/api/auth`;
export const ADMIN_API_BASE = `${getBackendRoot(ROBLOX_API_BASE) ?? ""}/api/admin`;

export { LEGACY_API_BASE_STORAGE_KEY as API_BASE_STORAGE_KEY };

export function readStoredSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.role) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session) {
  if (typeof window === "undefined" || !session?.token) return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore localStorage failures
  }
}

export function clearStoredSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore localStorage failures
  }
}

// Ruang pantau disembunyikan, dibuka lewat /admin atau ?admin=1
export function isHiddenAdminRoute() {
  if (typeof window === "undefined") return false;
  try {
    const query = new URLSearchParams(String(window.location.search || ""));
    if (query.get("admin") === "1") return true;
  } catch {
    // abaikan query yang tidak valid
  }
  return /\/admin\/?$/.test(String(window.location.pathname || ""));
}

export function getAuthToken() {
  return String(readStoredSession()?.token || "");
}

export function buildAuthHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getAuthToken();
  if (token) headers["X-Auth-Token"] = token;
  return headers;
}

// Bersihkan setting lama supaya base URL benar-benar otomatis.
export function cleanupLegacyApiBaseUrl() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_API_BASE_STORAGE_KEY);
  } catch {
    // ignore localStorage failures
  }
}

// Ambil prefix backend dari base URL API Roblox.
// "/api/roblox" -> "" (same-origin, pakai proxy vite/hosting), "https://backend/api/roblox" -> "https://backend"
export function getBackendRoot(apiBaseUrl) {
  const trimmed = String(apiBaseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const apiIndex = trimmed.indexOf("/api/");
  if (apiIndex >= 0) return trimmed.slice(0, apiIndex);
  return trimmed;
}

export function notifyUnauthorized() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

export function onUnauthorized(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

export async function apiRequest(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers: buildAuthHeaders(options.headers || {}),
      signal: controller.signal,
    });

    let data = {};
    const rawBody = await response.text();
    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      data = { ok: false, message: String(rawBody || "").slice(0, 300) || `Respons tidak valid (HTTP ${response.status}).` };
    }

    if (response.status === 401) notifyUnauthorized();

    return { response, data };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Request timeout. Backend terlalu lama merespons.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
