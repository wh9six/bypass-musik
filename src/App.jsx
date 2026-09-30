import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import LoginScreen from "./LoginScreen.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import { buildAuthHeaders, clearStoredSession, isHiddenAdminRoute, notifyUnauthorized, onUnauthorized, readStoredSession, saveStoredSession, ROBLOX_API_BASE, AUTH_API_BASE } from "./authSession.js";

const ACCEPTED_FORMATS = [".mp3", ".ogg", ".wav", ".flac"];
const FIXED_DESCRIPTION = "whis imut";
const BRAND_OWNER = "WHisky";
const MAX_ASSET_NAME_LENGTH = 36;
const DEFAULT_MAX_BATCH_FILES = 9999;
const PROCESS_REQUEST_TIMEOUT_MS = 180000;
const BATCH_EXTRA_TIMEOUT_PER_ITEM_MS = 90000;
const MAX_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const PROGRESS_TICK_MS = 350;
const DEFAULT_STUDIO_SUFFIX = "- BKB";

const STUDIO_FALLBACK = {
  studioPlaybackSpeed: "0.43",
  studioTargetService: "SoundService",
  studioFolderName: "BypassSounds",
  nameSuffix: DEFAULT_STUDIO_SUFFIX,
  autoUppercase: true,
};

function prettyFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isLikelyAudioUrl(value) {
  return /\.(mp3|ogg|wav|flac)(\?.*)?$/i.test(value.trim());
}

function isLikelyYouTubeUrl(value) {
  return /(youtube\.com|youtu\.be)/i.test(value.trim());
}

function cleanupName(value) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/www\./i, "")
    .replace(/[?#].*$/, "")
    .replace(/[\-_]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenAssetName(value, maxLength = MAX_ASSET_NAME_LENGTH) {
  const cleaned = cleanupName(value);
  if (!cleaned) return "WHisky Audio";
  if (cleaned.length <= maxLength) return cleaned;

  const sliced = cleaned.slice(0, maxLength).trim();
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > 10) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced;
}

function formatDisplayName(baseName, suffix = "", uppercase = true, maxLength = MAX_ASSET_NAME_LENGTH) {
  let cleaned = cleanupName(baseName);
  let trimmedSuffix = String(suffix || "").trim();

  if (trimmedSuffix) {
    if (!trimmedSuffix.startsWith("-") && !trimmedSuffix.startsWith("|") && !trimmedSuffix.startsWith("_")) {
      trimmedSuffix = `- ${trimmedSuffix}`;
    }
    const maxBaseLen = Math.max(3, maxLength - trimmedSuffix.length - 1);
    if (cleaned.length > maxBaseLen) {
      cleaned = cleaned.slice(0, maxBaseLen).trim();
    }
    cleaned = `${cleaned} ${trimmedSuffix}`.trim();
  } else {
    cleaned = shortenAssetName(cleaned, maxLength);
  }

  if (uppercase) {
    cleaned = cleaned.toUpperCase();
  }

  return cleaned || (uppercase ? "WHISKY AUDIO" : "WHisky Audio");
}

function computeRequestTimeoutMs({ itemCount, processingMode }) {
  const safeCount = Math.max(1, Number(itemCount) || 1);
  let timeout = PROCESS_REQUEST_TIMEOUT_MS;

  if (safeCount > 1) {
    timeout += (safeCount - 1) * BATCH_EXTRA_TIMEOUT_PER_ITEM_MS;
  }

  if (processingMode === "custom") {
    timeout += 45000;
  }

  return Math.min(timeout, MAX_REQUEST_TIMEOUT_MS);
}

function isRequestTimeoutMessage(message) {
  return /request timeout/i.test(String(message || ""));
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("id-ID");
}

function sanitizeLuaString(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .trim();
}

function formatStudioSoundName(rawName, suffix = "", uppercase = true) {
  let name = String(rawName || "").trim();
  let trimmedSuffix = String(suffix || "").trim();

  if (trimmedSuffix) {
    if (!trimmedSuffix.startsWith("-") && !trimmedSuffix.startsWith("|") && !trimmedSuffix.startsWith("_") && !trimmedSuffix.startsWith("[")) {
      trimmedSuffix = `- ${trimmedSuffix}`;
    }
    name = `${name} ${trimmedSuffix}`.trim();
  }

  if (uppercase) {
    name = name.toUpperCase();
  }

  return sanitizeLuaString(name || "SOUND");
}

function generateRobloxStudioScript(items, {
  playbackSpeed = "0.43",
  targetService = "SoundService",
  folderName = "BypassSounds",
  volume = 0.5,
  nameSuffix = "",
  autoUppercase = true,
} = {}) {
  const validItems = (Array.isArray(items) ? items : []).filter((item) => item && (item.assetId || item.id));
  if (!validItems.length) return "";

  const speedVal = Number(playbackSpeed) || 0.43;
  const target = String(targetService || "SoundService").trim();
  const folder = String(folderName || "BypassSounds").trim();

  const lines = validItems
    .map((item) => {
      const rawName = item.uploadedName || item.originalName || item.sourceName || "Sound";
      const name = formatStudioSoundName(rawName, nameSuffix, autoUppercase);
      const id = String(item.assetId || item.id).trim();
      return `\t{ name = "${name}", id = "${id}" },`;
    })
    .join("\n");

  return `-- ========================================================
-- Roblox Studio Audio Loader (WHisky Studio Bypass)
-- Total Sound: ${validItems.length} | PlaybackSpeed: ${speedVal}
-- Tag / Suffix: "${nameSuffix || "Tanpa Tag"}" | Huruf Kapital: ${autoUppercase ? "YA" : "TIDAK"}
--
-- CARA PAKAI:
-- 1. Buka project game di Roblox Studio
-- 2. Buka Command Bar (Menu View > Command Bar di bawah)
-- 3. Paste seluruh script ini lalu tekan ENTER
-- 4. Semua Sound otomatis dibuat di game.${target}.${folder}
-- ========================================================

local parentService = game:GetService("${target}")
local folder = parentService:FindFirstChild("${folder}")
if not folder then
\tfolder = Instance.new("Folder")
\tfolder.Name = "${folder}"
\tfolder.Parent = parentService
end

local soundList = {
${lines}
}

local totalLoaded = 0
for _, item in ipairs(soundList) do
\tlocal sound = folder:FindFirstChild(item.name)
\tif not sound then
\t\tsound = Instance.new("Sound")
\t\tsound.Name = item.name
\t\tsound.Parent = folder
\tend
\tsound.SoundId = "rbxassetid://" .. item.id
\tsound.PlaybackSpeed = ${speedVal}
\tsound.Volume = ${volume}
\ttotalLoaded = totalLoaded + 1
end

print(string.format("✅ [Bypas-Musik] Sukses memuat %d Sound di %s.%s (PlaybackSpeed: %s)!", totalLoaded, "${target}", "${folder}", tostring(${speedVal})))
`;
}

function generateSingleSoundLua(item, {
  playbackSpeed = "0.43",
  nameSuffix = "",
  autoUppercase = true,
} = {}) {
  const rawName = item?.uploadedName || item?.originalName || item?.sourceName || "Sound";
  const name = formatStudioSoundName(rawName, nameSuffix, autoUppercase);
  const id = String(item?.assetId || item?.id || "").trim();
  const speedVal = Number(playbackSpeed) || 0.43;
  return `local s = Instance.new("Sound", game:GetService("SoundService")); s.Name = "${name}"; s.SoundId = "rbxassetid://${id}"; s.PlaybackSpeed = ${speedVal}; s.Volume = 0.5; print("✅ Sound created: " .. s.Name);`;
}

function isHtmlResponseBody(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return text.includes("<!doctype html") || text.includes("<html") || text.includes("<body");
}

function buildAssetName({ fileName, url }) {
  if (fileName) {
    return shortenAssetName(fileName);
  }

  const rawUrl = (url || "").trim();
  if (!rawUrl) return "WHisky Audio";

  try {
    const parsed = new URL(rawUrl);
    const pathPart = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    if (pathPart && pathPart !== "/") {
      return shortenAssetName(decodeURIComponent(pathPart));
    }
    return shortenAssetName(parsed.hostname);
  } catch {
    return shortenAssetName(rawUrl);
  }
}

async function fetchJsonWithTimeout(url, options, timeoutMs = PROCESS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers: buildAuthHeaders(options?.headers || {}),
      signal: controller.signal,
    });

    if (response.status === 401) {
      clearStoredSession();
      notifyUnauthorized();
    }

    const rawBody = await response.text();
    let data;

    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      const nonJsonText = String(rawBody || "").trim();
      data = {
        ok: false,
        message: isHtmlResponseBody(nonJsonText)
          ? `Backend endpoint tidak ditemukan atau belum benar (HTTP ${response.status}). Cek Base URL backend.`
          : nonJsonText.slice(0, 500) || `Backend mengembalikan respons tidak valid (HTTP ${response.status}).`,
      };
    }

    return { response, data };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timeout. Proses terlalu lama, cek backend atau coba file lebih kecil.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function UserWorkspace({ session, onLogout }) {
  const [mode, setMode] = useState("file");
  // Import URL selalu lewat proxy YouTube (link audio langsung tidak dipakai lagi)
  const importMode = "youtube-proxy";
  const [urlUploadMode, setUrlUploadMode] = useState("single");
  const [fileUploadMode, setFileUploadMode] = useState("single");
  const [audioFile, setAudioFile] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [audioUrl, setAudioUrl] = useState("");
  const apiBaseUrl = ROBLOX_API_BASE;
  const [confirmRights, setConfirmRights] = useState(false);
  const [loading, setLoading] = useState(false);
  const progressTimerRef = useRef(null);
  const [progressValue, setProgressValue] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Standby");
  const [result, setResult] = useState(null);
  const [statusText, setStatusText] = useState("WHisky Studio siap dipakai. Pilih sumber audio lalu upload ke Roblox.");
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [historyDate, setHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploadHistory, setUploadHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedBatchFilter, setSelectedBatchFilter] = useState("all");
  const [studioPlaybackSpeed, setStudioPlaybackSpeed] = useState(STUDIO_FALLBACK.studioPlaybackSpeed);
  const [studioTargetService, setStudioTargetService] = useState(STUDIO_FALLBACK.studioTargetService);
  const [studioFolderName, setStudioFolderName] = useState(STUDIO_FALLBACK.studioFolderName);
  const [customSuffix, setCustomSuffix] = useState(STUDIO_FALLBACK.nameSuffix);
  const [autoUppercase, setAutoUppercase] = useState(STUDIO_FALLBACK.autoUppercase);
  const [healthRefreshToken, setHealthRefreshToken] = useState(0);

  const trimmedUrl = audioUrl.trim();
  const urlTargets = useMemo(() => {
    if (urlUploadMode === "single") return trimmedUrl ? [trimmedUrl] : [];

    const maxUrls = Number(health?.collaboration?.maxBatchFiles || DEFAULT_MAX_BATCH_FILES);

    return audioUrl
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, maxUrls);
  }, [urlUploadMode, trimmedUrl, audioUrl, health]);

  const fileSummary = useMemo(() => {
    if (fileUploadMode === "single") {
      if (!audioFile) return "Belum ada file dipilih";
      return `${audioFile.name} - ${prettyFileSize(audioFile.size)}`;
    }

    if (!audioFiles.length) return "Belum ada file batch dipilih";
    const totalBytes = audioFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
    return `${audioFiles.length} file - total ${prettyFileSize(totalBytes)}`;
  }, [fileUploadMode, audioFile, audioFiles]);

  const generatedAssetName = useMemo(() => {
    if (mode === "url") {
      if (urlTargets.length > 1) return `Batch ${urlTargets.length} URL audio`;
      return buildAssetName({ url: urlTargets[0] || audioUrl });
    }
    if (fileUploadMode === "single") return buildAssetName({ fileName: audioFile?.name });
    if (audioFiles.length === 1) return buildAssetName({ fileName: audioFiles[0]?.name });
    return audioFiles.length > 1 ? `Batch ${audioFiles.length} audio` : "WHisky Audio";
  }, [mode, fileUploadMode, audioFile, audioFiles, audioUrl, urlTargets]);

  const maxDurationLabel = useMemo(() => {
    const seconds = Number(health?.maxAudioSeconds || 0);
    if (!seconds) return "-";
    const minutes = Math.floor(seconds / 60);
    const remain = seconds % 60;
    return remain === 0 ? `${minutes} menit` : `${minutes}m ${remain}d`;
  }, [health]);

  const maxUploadLabel = useMemo(() => prettyFileSize(Number(health?.maxAudioBytes || 0)), [health]);

  // Mode & setting audio ditentukan server (pengaturan admin), bukan dari halaman ini.
  const processingMode = health?.audioProcessing?.defaultMode === "ori" ? "ori" : "custom";

  const maxBatchFiles = Number(health?.collaboration?.maxBatchFiles || DEFAULT_MAX_BATCH_FILES);

  const availableBatches = useMemo(() => {
    const map = new Map();
    for (const item of uploadHistory) {
      const label = String(item?.batchLabel || item?.batchId || "Tanpa Ronde").trim();
      if (!map.has(label)) {
        map.set(label, { label, count: 0, validCount: 0 });
      }
      const data = map.get(label);
      data.count += 1;
      if (item?.assetId || item?.id) {
        data.validCount += 1;
      }
    }
    return Array.from(map.values());
  }, [uploadHistory]);

  const filteredUploadHistory = useMemo(() => {
    let list = uploadHistory;
    if (selectedBatchFilter !== "all") {
      list = list.filter((item) => {
        const label = String(item?.batchLabel || item?.batchId || "Tanpa Ronde").trim();
        return label === selectedBatchFilter;
      });
    }

    const keyword = historyQuery.trim().toLowerCase();
    if (!keyword) return list;

    return list.filter((item) => {
      const haystack = [item?.uploadRecordId, item?.uploadedName, item?.assetId, item?.operationId, item?.sourceName, item?.sourceUrl, item?.batchLabel]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(keyword);
    });
  }, [uploadHistory, selectedBatchFilter, historyQuery]);

  const validHistorySounds = useMemo(() => {
    return filteredUploadHistory.filter((item) => item && (item.assetId || item.id));
  }, [filteredUploadHistory]);

  const validResultSounds = useMemo(() => {
    if (!result || !result.ok) return [];
    if (Array.isArray(result.uploads) && result.uploads.length) {
      return result.uploads.filter((item) => item && item.ok && (item.assetId || item.id));
    }
    if (result.assetId) {
      return [result];
    }
    return [];
  }, [result]);

  

  const readinessItems = useMemo(() => {
    const sourceReady =
      mode === "file"
        ? fileUploadMode === "single"
          ? Boolean(audioFile)
          : audioFiles.length > 0
        : urlUploadMode === "single"
          ? Boolean(trimmedUrl)
          : urlTargets.length > 0;
    return [
      {
        label: "Sumber audio",
        value:
          mode === "file"
            ? fileUploadMode === "single"
              ? audioFile
                ? audioFile.name
                : "Belum pilih file"
              : audioFiles.length
                ? `${audioFiles.length} file batch`
                : "Belum pilih file batch"
            : urlUploadMode === "single"
              ? trimmedUrl || "URL belum diisi"
              : urlTargets.length
                ? `${urlTargets.length} URL siap diproses`
                : "URL batch belum diisi",
        ready: sourceReady,
      },
      {
        label: "Hak upload",
        value: confirmRights ? "Sudah dikonfirmasi" : "Belum dicentang",
        ready: confirmRights,
      },
      {
        label: "Akun",
        value: session?.username ? `Login sebagai ${session.username}` : "Belum login",
        ready: Boolean(session?.username),
      },
    ];
  }, [
    mode,
    fileUploadMode,
    urlUploadMode,
    audioFile,
    audioFiles,
    trimmedUrl,
    urlTargets,
    confirmRights,
    session,
  ]);

  const readyCount = readinessItems.filter((item) => item.ready).length;
  const statusTone = loading ? "loading" : result ? (result.ok ? "success" : "error") : "idle";

  const usageNote = useMemo(() => {
    if (mode === "url" && importMode === "youtube-proxy") {
      return "Server akan mengambil audio dari link YouTube, memprosesnya, lalu upload ke Roblox.";
    }
    return "Semua proses audio dijalankan di server, jadi tidak ada API key yang tersimpan di browser.";
  }, [mode, importMode]);

  function refreshHealthSnapshot() {
    setHealthRefreshToken((previous) => previous + 1);
  }

  async function handleUserLogout() {
    try {
      await fetchJsonWithTimeout(`${AUTH_API_BASE}/logout`, { method: "POST" }, 15000);
    } catch {
      // ignore logout network failure
    }
    clearStoredSession();
    onLogout();
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadHealth() {
      setHealthLoading(true);
      setHealthError("");

      try {
        const { response, data } = await fetchJsonWithTimeout(`${apiBaseUrl}/health`, {
          method: "GET",
          signal: controller.signal,
        });
        if (!active) return;

        if (!response.ok || !data?.ok) {
          setHealth(null);
          setHealthError(data?.message || "Gagal membaca status server.");
          return;
        }

        setHealth(data);
      } catch (error) {
        if (!active || error?.name === "AbortError") return;
        setHealth(null);
        setHealthError("Koneksi ke server gagal, coba lagi.");
      } finally {
        if (active) setHealthLoading(false);
      }
    }

    loadHealth();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiBaseUrl, healthRefreshToken]);

  useEffect(() => {
    let active = true;

    async function loadStudioSettings() {
      try {
        const { response, data } = await fetchJsonWithTimeout(`${apiBaseUrl}/settings/studio`, { method: "GET" }, 20000);
        if (!active || !response.ok || !data?.ok || !data.settings) return;
        setStudioPlaybackSpeed(String(data.settings.studioPlaybackSpeed ?? STUDIO_FALLBACK.studioPlaybackSpeed));
        setStudioTargetService(String(data.settings.studioTargetService ?? STUDIO_FALLBACK.studioTargetService));
        setStudioFolderName(String(data.settings.studioFolderName ?? STUDIO_FALLBACK.studioFolderName));
        setCustomSuffix(String(data.settings.nameSuffix ?? STUDIO_FALLBACK.nameSuffix));
        setAutoUppercase(Boolean(data.settings.autoUppercase ?? STUDIO_FALLBACK.autoUppercase));
      } catch {
        // pakai bawaan kalau pengaturan belum kebaca
      }
    }

    loadStudioSettings();
    return () => {
      active = false;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, []);

  function stopProgressTracker() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgressValue(0);
    setProgressLabel("Standby");
  }

  function startProgressTracker({ sourceType, processingMode: activeMode, timeoutMs }) {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    const startedAt = Date.now();
    const safeTimeoutMs = Math.max(45000, Number(timeoutMs) || PROCESS_REQUEST_TIMEOUT_MS);

    setProgressValue(2);
    setProgressLabel(sourceType === "url" ? "Mengambil sumber URL..." : "Menyiapkan file upload...");

    progressTimerRef.current = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const ratio = Math.min(0.97, elapsedMs / safeTimeoutMs);
      const easedPercent = Math.min(97, Math.max(2, Math.round(Math.pow(ratio, 0.72) * 100)));

      let nextLabel = sourceType === "url" ? "Mengambil sumber URL..." : "Membaca file audio...";
      if (ratio >= 0.2) nextLabel = activeMode === "custom" ? "Memproses audio (custom)..." : "Menyiapkan audio ori...";
      if (ratio >= 0.55) nextLabel = "Mengirim ke Roblox...";
      if (ratio >= 0.75) nextLabel = "Menunggu konfirmasi asset Roblox...";

      setProgressValue(easedPercent);
      setProgressLabel(nextLabel);
    }, PROGRESS_TICK_MS);
  }

  async function loadUploadHistory(targetDate = historyDate) {
    const normalizedBase = String(apiBaseUrl || "").trim();
    if (!normalizedBase) {
      setUploadHistory([]);
      setHistoryError("Base URL backend belum diisi.");
      return;
    }

    const normalizedDate = String(targetDate || "").trim();
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const url = normalizedDate
        ? `${normalizedBase}/upload-history?date=${encodeURIComponent(normalizedDate)}&limit=500`
        : `${normalizedBase}/upload-history?limit=500`;

      const { response, data } = await fetchJsonWithTimeout(url, {
        method: "GET",
      });

      if (!response.ok || !data?.ok) {
        setUploadHistory([]);
        setHistoryError(data?.message || "Gagal mengambil riwayat upload.");
        return;
      }

      setUploadHistory(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setUploadHistory([]);
      setHistoryError(error instanceof Error ? error.message : "Gagal mengambil riwayat upload.");
    } finally {
      setHistoryLoading(false);
    }
  }

  

  async function copyToClipboard(label, value) {
    const text = String(value || "").trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setStatusText(`${label} berhasil disalin: ${text}`);
    } catch {
      setStatusText(`Gagal copy ${label}. Browser menolak akses clipboard.`);
    }
  }

  async function copyStudioScript(items, label = "Script Roblox Studio") {
    const valid = (Array.isArray(items) ? items : []).filter((item) => item && (item.assetId || item.id));
    if (!valid.length) {
      setStatusText("Tidak ada sound dengan Asset ID valid.");
      return;
    }
    const script = generateRobloxStudioScript(valid, {
      playbackSpeed: studioPlaybackSpeed,
      targetService: studioTargetService,
      folderName: studioFolderName,
      nameSuffix: customSuffix,
      autoUppercase,
    });
    try {
      await navigator.clipboard.writeText(script);
      setStatusText(`⚡ ${label} (${valid.length} sound, PlaybackSpeed: ${studioPlaybackSpeed}, Tag: '${customSuffix || "Tanpa Tag"}') berhasil disalin! Paste di Command Bar Studio.`);
    } catch {
      setStatusText("Gagal menyalin script ke clipboard.");
    }
  }

  function downloadStudioScript(items, fileName = "RobloxStudioSounds.lua") {
    const valid = (Array.isArray(items) ? items : []).filter((item) => item && (item.assetId || item.id));
    if (!valid.length) {
      setStatusText("Tidak ada sound dengan Asset ID valid.");
      return;
    }
    const script = generateRobloxStudioScript(valid, {
      playbackSpeed: studioPlaybackSpeed,
      targetService: studioTargetService,
      folderName: studioFolderName,
      nameSuffix: customSuffix,
      autoUppercase,
    });
    const blob = new Blob([script], { type: "text/plain;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    setStatusText(`📥 Script Luau Roblox Studio (${valid.length} sound) berhasil didownload.`);
  }

  async function copySingleSoundLua(item) {
    if (!item?.assetId && !item?.id) {
      setStatusText("Asset ID tidak ditemukan.");
      return;
    }
    const lua = generateSingleSoundLua(item, {
      playbackSpeed: studioPlaybackSpeed,
      nameSuffix: customSuffix,
      autoUppercase,
    });
    try {
      await navigator.clipboard.writeText(lua);
      const name = formatStudioSoundName(item?.uploadedName || item?.sourceName || "Sound", customSuffix, autoUppercase);
      setStatusText(`Command Lua untuk '${name}' berhasil disalin (Speed: ${studioPlaybackSpeed})!`);
    } catch {
      setStatusText("Gagal menyalin Lua command bar.");
    }
  }

  function handleSingleFileChange(event) {
    const pickedFile = event.target.files?.[0] || null;
    setAudioFile(pickedFile);
    if (pickedFile) {
      setAudioFiles([pickedFile]);
    }
  }

  function handleMultiFileChange(event) {
    const pickedFiles = Array.from(event.target.files || []);
    setAudioFiles(pickedFiles);
    setAudioFile(pickedFiles[0] || null);
  }

  async function uploadFromFile() {
    const filesToUpload = fileUploadMode === "single" ? (audioFile ? [audioFile] : []) : audioFiles;

    if (!filesToUpload.length) {
      setStatusText(fileUploadMode === "single" ? "Pilih file audio dulu." : "Pilih minimal 1 file untuk batch upload.");
      return;
    }

    if (!confirmRights) {
      setStatusText("Centang konfirmasi hak pakai audio dulu.");
      return;
    }

    const formData = new FormData();
    if (fileUploadMode === "single") {
      formData.append("file", filesToUpload[0]);
    } else {
      filesToUpload.forEach((file) => formData.append("files", file));
    }
    formData.append("displayName", fileUploadMode === "multi" ? "" : generatedAssetName);
    formData.append("description", FIXED_DESCRIPTION);
    formData.append("assetType", "Audio");
    formData.append("targetProfile", "whis-tone-match");
    formData.append("uploadMode", fileUploadMode);

    setLoading(true);
    const requestTimeoutMs = computeRequestTimeoutMs({
      itemCount: filesToUpload.length,
      processingMode,
    });
    startProgressTracker({
      sourceType: "file",
      processingMode,
      timeoutMs: requestTimeoutMs,
    });
    setResult(null);
    if (fileUploadMode === "multi") {
      setStatusText(
        processingMode === "custom"
          ? `Memproses ${filesToUpload.length} file custom lalu upload batch ke Roblox...`
          : `Upload batch ${filesToUpload.length} file ori ke Roblox...`
      );
    } else {
      setStatusText(processingMode === "custom" ? "Memproses audio custom lalu upload ke Roblox..." : "Upload audio ori ke Roblox...");
    }

    try {
      const { data } = await fetchJsonWithTimeout(`${apiBaseUrl}/upload-file`, {
        method: "POST",
        body: formData,
      },
      requestTimeoutMs);
      setResult(data);
      if (data?.ok) {
        const refreshDate =
          data.uploadDate ||
          (Array.isArray(data.uploads) ? data.uploads.find((item) => item?.uploadDate)?.uploadDate : "") ||
          historyDate;
        if (refreshDate) {
          setHistoryDate(refreshDate);
          loadUploadHistory(refreshDate);
        }
      }
      setStatusText(
        data.ok
          ? fileUploadMode === "multi"
            ? `Batch selesai: ${data.successCount || 0} sukses, ${data.failedCount || 0} gagal.`
            : processingMode === "custom"
              ? `Sukses. Audio custom terupload sebagai ${data.uploadedName || generatedAssetName}.`
              : `Sukses. Audio ori terupload sebagai ${data.uploadedName || generatedAssetName}.`
          : data.message || "Upload gagal."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      if (isRequestTimeoutMessage(message)) {
        setStatusText("Request timeout di browser, tapi backend mungkin masih memproses. Cek panel riwayat upload.");
        await loadUploadHistory(historyDate);
      } else {
        setStatusText(`Gagal mengirim file ke server. ${message}`);
      }
      setResult({ ok: false, message });
    } finally {
      setLoading(false);
      stopProgressTracker();
    }
  }

  async function uploadFromUrl() {
    if (!urlTargets.length) {
      setStatusText(urlUploadMode === "single" ? "Masukkan URL dulu." : "Isi minimal 1 URL untuk batch import.");
      return;
    }

    if (!confirmRights) {
      setStatusText("Centang konfirmasi hak pakai audio dulu.");
      return;
    }

    if (importMode === "direct-audio-url" && urlTargets.some((target) => !isLikelyAudioUrl(target))) {
      setStatusText("Mode direct URL butuh link langsung ke file audio (.mp3/.ogg/.wav/.flac).");
      return;
    }

    if (importMode === "youtube-proxy" && urlTargets.some((target) => !isLikelyYouTubeUrl(target))) {
      setStatusText("Masukkan URL YouTube yang valid untuk mode proxy.");
      return;
    }

    setLoading(true);
    const requestTimeoutMs = computeRequestTimeoutMs({
      itemCount: urlTargets.length,
      processingMode,
    });
    startProgressTracker({
      sourceType: "url",
      processingMode,
      timeoutMs: requestTimeoutMs,
    });
    setResult(null);
    if (urlTargets.length > 1) {
      setStatusText(
        processingMode === "custom"
          ? `Memproses ${urlTargets.length} URL secara batch (custom) lalu upload ke Roblox...`
          : `Memproses ${urlTargets.length} URL secara batch (ori) lalu upload ke Roblox...`
      );
    } else {
      setStatusText(
        processingMode === "custom"
          ? "Mengambil URL, memproses custom, lalu upload ke Roblox..."
          : "Mengambil URL dan upload audio ori ke Roblox..."
      );
    }

    try {
      const { data } = await fetchJsonWithTimeout(`${apiBaseUrl}/import-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: urlTargets[0] || "",
          urls: urlTargets,
          urlUploadMode,
          displayName: generatedAssetName,
          description: FIXED_DESCRIPTION,
          assetType: "Audio",
          importMode,
          confirmRights,
          targetProfile: "whis-tone-match",
        }),
      },
      requestTimeoutMs);
      setResult(data);
      if (data?.ok) {
        const refreshDate =
          data.uploadDate ||
          (Array.isArray(data.uploads) ? data.uploads.find((item) => item?.uploadDate)?.uploadDate : "") ||
          historyDate;
        if (refreshDate) {
          setHistoryDate(refreshDate);
          loadUploadHistory(refreshDate);
        }
      }
      setStatusText(
        data.ok
          ? Number.isFinite(Number(data.successCount))
            ? `Batch URL selesai: ${data.successCount || 0} sukses, ${data.failedCount || 0} gagal.`
            : processingMode === "custom"
              ? `Sukses. Audio URL custom terupload sebagai ${data.uploadedName || generatedAssetName}.`
              : `Sukses. Audio URL ori terupload sebagai ${data.uploadedName || generatedAssetName}.`
          : data.message || "Import gagal."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      if (isRequestTimeoutMessage(message)) {
        setStatusText("Request timeout di browser, tapi backend mungkin masih memproses. Cek panel riwayat upload.");
        await loadUploadHistory(historyDate);
      } else {
        setStatusText(`Gagal mengirim URL ke server. ${message}`);
      }
      setResult({ ok: false, message });
    } finally {
      setLoading(false);
      stopProgressTracker();
    }
  }

  async function submitActiveMode() {
    if (loading) return;

    if (mode === "file") {
      await uploadFromFile();
      return;
    }
    await uploadFromUrl();
  }

  return (
    <div className="ws-page">
      <main className="ws-shell">
        <header className="ws-hero">
          <div className="ws-brand-row">
            <span className="ws-chip">WHISKY CREATOR TOOL</span>
            <span className="ws-chip ws-chip-owner">Creator: {BRAND_OWNER}</span>
            <button type="button" className="ws-mini-btn ws-topbar-logout" onClick={handleUserLogout}>
              🚪 Keluar
            </button>
          </div>

          <h1>Upload Lagu Roblox</h1>
          <p>
            Hai <b>{session?.username || "kamu"}</b>, pilih file audio atau tempel link YouTube, lalu tekan upload. Nama sound
            dan script Studio sudah diatur otomatis.
          </p>

          <p className="ws-hero-note">
            {healthLoading
              ? "Menyiapkan batas upload..."
              : `Batas audio ${maxDurationLabel} · ukuran maks ${maxUploadLabel} · mode ${processingMode === "custom" ? "custom" : "ori"}`}
          </p>
        </header>
        <div className="ws-grid">
          <section className="ws-card ws-main-card">
            <div className="ws-section-head">
              <strong>Upload</strong>
              <span>{mode === "file" ? "File audio" : "Link YouTube"}</span>
            </div>

            <div className="ws-toggle-row" role="tablist" aria-label="Pilih sumber input">
              <button
                type="button"
                className={mode === "file" ? "ws-tab active" : "ws-tab"}
                onClick={() => setMode("file")}
              >
                Upload File
              </button>
              <button
                type="button"
                className={mode === "url" ? "ws-tab active" : "ws-tab"}
                onClick={() => setMode("url")}
              >
                Import URL
              </button>
            </div>

            {mode === "file" ? (
              <Fragment key="mode-file">
                <div className="ws-fieldbox">
                  <label>Pilih jumlah file</label>
                  <div className="ws-toggle-row">
                    <button
                      type="button"
                      className={fileUploadMode === "single" ? "ws-tab active" : "ws-tab"}
                      onClick={() => setFileUploadMode("single")}
                    >
                      Satu File
                    </button>
                    <button
                      type="button"
                      className={fileUploadMode === "multi" ? "ws-tab active" : "ws-tab"}
                      onClick={() => setFileUploadMode("multi")}
                    >
                      Banyak File
                    </button>
                  </div>
                </div>

                <div className="ws-fieldbox">
                  <label htmlFor="audio-file">File audio</label>
                  <input
                    id="audio-file"
                    className="ws-input"
                    type="file"
                    accept={ACCEPTED_FORMATS.join(",")}
                    multiple={fileUploadMode === "multi"}
                    onChange={fileUploadMode === "multi" ? handleMultiFileChange : handleSingleFileChange}
                  />
                  <small>
                    {fileSummary}
                    {fileUploadMode === "multi" ? " (tanpa batas jumlah file)" : ""}
                  </small>
                  {fileUploadMode === "multi" && audioFiles.length > 0 && (
                    <div className="ws-result-list">
                      {audioFiles.slice(0, 5).map((file) => (
                        <div key={`${file.name}-${file.size}`}>
                          {file.name} - {prettyFileSize(file.size)}
                        </div>
                      ))}
                      {audioFiles.length > 5 && <div>+{audioFiles.length - 5} file lainnya</div>}
                    </div>
                  )}
                </div>
              </Fragment>
            ) : (
              <Fragment key="mode-url">
                <div className="ws-fieldbox">
                  <label>Jumlah link</label>
                  <div className="ws-toggle-row">
                    <button
                      type="button"
                      className={urlUploadMode === "single" ? "ws-tab active" : "ws-tab"}
                      onClick={() => setUrlUploadMode("single")}
                    >
                      Satu Link
                    </button>
                    <button
                      type="button"
                      className={urlUploadMode === "multi" ? "ws-tab active" : "ws-tab"}
                      onClick={() => setUrlUploadMode("multi")}
                    >
                      Banyak Link
                    </button>
                  </div>
                </div>

                <div className="ws-fieldbox">
                  <label htmlFor="audio-url">Link YouTube</label>
                  {urlUploadMode === "single" ? (
                    <input
                      id="audio-url"
                      className="ws-input"
                      inputMode="url"
                      value={audioUrl}
                      onChange={(e) => setAudioUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                  ) : (
                    <textarea
                      id="audio-url"
                      className="ws-input ws-textarea"
                      value={audioUrl}
                      onChange={(e) => setAudioUrl(e.target.value)}
                      placeholder={"https://www.youtube.com/watch?v=...\nhttps://youtu.be/..."}
                    />
                  )}
                  {urlUploadMode === "multi" && <small>{`Batch URL aktif: ${urlTargets.length} link (maks ${maxBatchFiles})`}</small>}
                </div>
              </Fragment>
            )}

            <label className="ws-checkbox" htmlFor="rights">
              <input
                id="rights"
                type="checkbox"
                checked={confirmRights}
                onChange={(e) => setConfirmRights(e.target.checked)}
              />
              <div>
                <strong>Saya punya hak legal untuk mengunggah audio ini</strong>
                <small>{usageNote}</small>
              </div>
            </label>

            <button type="button" className="ws-primary" disabled={loading} onClick={submitActiveMode}>
              {loading
                ? `Sedang memproses... ${Math.max(1, Math.min(97, Math.round(progressValue)))}%`
                : (mode === "file" && fileUploadMode === "multi") || (mode === "url" && urlUploadMode === "multi")
                  ? "Proses dan Upload Batch ke Roblox"
                  : "Proses Audio dan Upload ke Roblox"}
            </button>
          </section>

          <section className="ws-card ws-side-card">
            <div className="ws-section-head">
              <strong>Status Upload</strong>
              <span>{result?.ok ? "Success" : result ? "Perlu cek" : "Standby"}</span>
            </div>

            <div className={`ws-status ${statusTone}`}>
              <small>Status terbaru</small>
              <p>{statusText}</p>
            </div>

            {loading && (
              <div className="ws-progress" aria-live="polite">
                <div className="ws-progress-head">
                  <small>Progress estimasi</small>
                  <strong>{Math.max(1, Math.min(97, Math.round(progressValue)))}%</strong>
                </div>
                <div className="ws-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressValue)}>
                  <div className="ws-progress-fill" style={{ width: `${Math.max(2, Math.min(97, progressValue))}%` }} />
                </div>
                <p>{progressLabel}</p>
              </div>
            )}

            <div className="ws-checklist">
              {readinessItems.map((item) => (
                <div key={item.label} className={item.ready ? "ws-check ready" : "ws-check"}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.value}</small>
                  </div>
                  <span>{item.ready ? "OK" : "CHECK"}</span>
                </div>
              ))}
            </div>

            {result && (
              <div className={result.ok ? "ws-result ok" : "ws-result fail"}>
                <strong>{result.ok ? "Upload berhasil" : "Upload gagal"}</strong>
                {result.assetId && (
                  <div className="ws-row-split">
                    <span>Asset ID: {result.assetId}</span>
                    <button type="button" className="ws-mini-btn" onClick={() => copyToClipboard("Asset ID", result.assetId)}>
                      Copy
                    </button>
                  </div>
                )}
                {result.operationId && <div>Operation ID: {result.operationId}</div>}
                {result.uploadRecordId && <div>ID Simpan: #{result.uploadRecordId}</div>}
                {result.uploadDate && <div>Tanggal Upload: {result.uploadDate}</div>}
                {result.uploadedAt && <div>Waktu Upload: {formatDateTime(result.uploadedAt)}</div>}
                {result.uploadedName && <div>Nama: {result.uploadedName}</div>}
                {Number.isFinite(Number(result.successCount)) && (
                  <div>
                    Batch: {result.successCount} sukses / {result.failedCount || 0} gagal
                  </div>
                )}
                {result.processingMode && <div>Mode: {result.processingMode}</div>}
                {result.audioSettings && (
                  <div>
                    Setting: speed {result.audioSettings.changeSpeedValue}x, OGG q{result.audioSettings.exportOggQuality},
                    amp {result.audioSettings.ampDb} dB
                  </div>
                )}
                {Array.isArray(result.uploads) && result.uploads.length > 1 && (
                  <div className="ws-result-list">
                    {result.uploads.slice(0, 8).map((item, index) => (
                      <div key={`${item.originalName || item.uploadedName || index}-${index}`} className="ws-row-split">
                        <span>
                          {item.ok ? "OK" : "FAIL"} - {item.originalName || item.uploadedName}
                          {item.assetId ? ` (Asset ${item.assetId})` : ""}
                          {item.uploadRecordId ? ` [ID ${item.uploadRecordId}]` : ""}
                          {item.uploadDate ? ` [${item.uploadDate}]` : ""}
                        </span>
                        {item.assetId && (
                          <button type="button" className="ws-mini-btn" onClick={() => copyToClipboard("Asset ID", item.assetId)}>
                            Copy
                          </button>
                        )}
                      </div>
                    ))}
                    {result.uploads.length > 8 && <div>+{result.uploads.length - 8} hasil lainnya</div>}
                  </div>
                )}
                {result.message && <div>{result.message}</div>}
                {validResultSounds.length > 0 && (
                  <div className="ws-result-studio-action">
                    <button
                      type="button"
                      className="ws-primary ws-studio-btn"
                      onClick={() => copyStudioScript(validResultSounds, "Script Hasil Upload")}
                    >
                      ⚡ Copy Script Roblox Studio ({validResultSounds.length} Sound Baru, Speed: {studioPlaybackSpeed})
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="ws-fieldbox">
              <div className="ws-section-head">
                <label htmlFor="history-date">Riwayat Upload Kamu per Tanggal</label>
                {validHistorySounds.length > 0 && (
                  <span className="ws-chip-badge">{validHistorySounds.length} Sound Siap Studio</span>
                )}
              </div>
              <input
                id="history-date"
                className="ws-input"
                type="date"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
              />

              {/* Batch / Ronde Filter Tabs */}
              {availableBatches.length > 0 && (
                <div className="ws-batch-filter-panel">
                  <small>🎯 Filter Ronde / Batch:</small>
                  <div className="ws-batch-tabs">
                    <button
                      type="button"
                      className={`ws-batch-tab ${selectedBatchFilter === "all" ? "active" : ""}`}
                      onClick={() => setSelectedBatchFilter("all")}
                    >
                      Semua Ronde ({uploadHistory.length})
                    </button>
                    {availableBatches.map((b) => (
                      <button
                        key={b.label}
                        type="button"
                        className={`ws-batch-tab ${selectedBatchFilter === b.label ? "active" : ""}`}
                        onClick={() => setSelectedBatchFilter(b.label)}
                      >
                        {b.label} ({b.count} sound)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="ws-admin-actions">
                <button
                  type="button"
                  className="ws-outline"
                  disabled={historyLoading}
                  onClick={() => {
                    loadUploadHistory(historyDate);
                    refreshHealthSnapshot();
                  }}
                >
                  {historyLoading ? "Mengambil riwayat..." : "Ambil Riwayat"}
                </button>
              </div>

              <input
                id="history-query"
                className="ws-input"
                aria-label="Cari riwayat upload"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Filter: asset ID / nama / operation ID / ronde"
              />

              {/* Script Roblox Studio (speed, folder, dan tag diatur otomatis) */}
              <div className="ws-studio-panel">
                <button
                  type="button"
                  className="ws-primary ws-studio-btn"
                  disabled={!validHistorySounds.length}
                  onClick={() => copyStudioScript(validHistorySounds, `Script ${selectedBatchFilter === "all" ? "Riwayat" : selectedBatchFilter}`)}
                >
                  ⚡ Copy Script Roblox Studio ({validHistorySounds.length} Sound)
                </button>

                <div className="ws-btn-row">
                  <button
                    type="button"
                    className="ws-outline"
                    disabled={!validHistorySounds.length}
                    onClick={() => downloadStudioScript(validHistorySounds, `RobloxSounds-${historyDate || "batch"}.lua`)}
                  >
                    📥 Download .lua
                  </button>
                </div>

                <div className="ws-studio-meta-row">
                  <small>
                    Script pakai PlaybackSpeed <b>{studioPlaybackSpeed}</b>, folder <b>{studioFolderName}</b> di{" "}
                    <b>{studioTargetService}</b>. Buka <b>View &gt; Command Bar</b> di Roblox Studio, paste, tekan Enter.
                  </small>
                </div>
              </div>

              {historyError && <small>{historyError}</small>}
              {!historyError && (
                <small>
                  {uploadHistory.length > 0
                    ? `${uploadHistory.length} data ditemukan (${filteredUploadHistory.length} setelah filter).`
                    : historyLoading
                      ? "Memuat data..."
                      : `Belum ada upload untuk ${historyDate}.`}
                </small>
              )}
              {filteredUploadHistory.length > 0 && (
                <div className="ws-result-list">
                  {filteredUploadHistory.slice(0, 20).map((item) => (
                    <div key={`${item.uploadRecordId}-${item.assetId || item.operationId || "no-id"}`} className="ws-row-split">
                      <span>
                        #{item.uploadRecordId} - <b>{item.uploadedName || "Tanpa nama"}</b>
                        {item.batchLabel && <span className="ws-round-badge">{item.batchLabel}</span>}
                        {item.assetId ? ` (ID: ${item.assetId})` : ""} - {formatDateTime(item.uploadedAt)}
                      </span>
                      <div className="ws-action-btn-group">
                        {item.assetId && (
                          <>
                            <button
                              type="button"
                              className="ws-mini-btn"
                              title="Copy Asset ID"
                              onClick={() => copyToClipboard("Asset ID", item.assetId)}
                            >
                              Copy ID
                            </button>
                            <button
                              type="button"
                              className="ws-mini-btn ws-mini-btn-accent"
                              title="Copy baris Lua untuk Command Bar Roblox Studio"
                              onClick={() => copySingleSoundLua(item)}
                            >
                              Copy Lua
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredUploadHistory.length > 20 && <div>+{filteredUploadHistory.length - 20} data lainnya</div>}
                </div>
              )}
            </div>

            {healthError && <div className="ws-alert">{healthError}</div>}
          </section>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => readStoredSession());

  useEffect(() => onUnauthorized(() => setSession(null)), []);

  function handleLogin(nextSession) {
    saveStoredSession(nextSession);
    setSession(nextSession);
  }

  function handleLogout() {
    clearStoredSession();
    setSession(null);
  }

  if (!session || (isHiddenAdminRoute() && session.role !== "admin")) {
    return <LoginScreen key={isHiddenAdminRoute() ? "ruang-pantau" : "masuk"} onLogin={handleLogin} />;
  }

  if (session.role === "admin") {
    return <AdminDashboard session={session} onLogout={handleLogout} />;
  }

  return <UserWorkspace session={session} onLogout={handleLogout} />;
}

export const __testables__ = {
  prettyFileSize,
  isLikelyAudioUrl,
  isLikelyYouTubeUrl,
  cleanupName,
  shortenAssetName,
  buildAssetName,
  FIXED_DESCRIPTION,
  MAX_ASSET_NAME_LENGTH,
  ACCEPTED_FORMATS,
};
