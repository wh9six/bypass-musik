import "dotenv/config";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import ffmpegStatic from "ffmpeg-static";
import multer from "multer";
import ytdl from "@distube/ytdl-core";

const app = express();

const PORT = Number(process.env.PORT || 8787);
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 80 * 1024 * 1024);
const MAX_AUDIO_SECONDS = Number(process.env.MAX_AUDIO_SECONDS || 420);
const ROBLOX_UPLOAD_CONCURRENCY = Math.max(1, Number(process.env.ROBLOX_UPLOAD_CONCURRENCY || 5));
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 180000);
const POLL_ENABLED = (process.env.ROBLOX_POLL_OPERATION || "true").toLowerCase() !== "false";
const POLL_ATTEMPTS = Number(process.env.ROBLOX_POLL_ATTEMPTS || 30);
const POLL_INTERVAL_MS = Number(process.env.ROBLOX_POLL_INTERVAL_MS || 2000);
const ROBLOX_ASSETS_API_BASE_URL = (process.env.ROBLOX_ASSETS_API_BASE_URL || "https://apis.roblox.com/assets/v1").replace(/\/+$/, "");

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".webm"]);
const AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/webm",
  "application/octet-stream",
];
const FFMPEG_BINARY = String(process.env.FFMPEG_PATH || ffmpegStatic || "").trim();
const SUPPORTED_TONE_PROFILES = new Set(["whis-tone-match"]);
const YTDL_COOKIES_JSON = String(process.env.YTDL_COOKIES_JSON || "").trim();
const YTDL_COOKIES_FILE = String(process.env.YTDL_COOKIES_FILE || "").trim();
const DEFAULT_COOKIES_FILE_PATH = path.join(process.cwd(), "cookies.json");
const YTDLP_COOKIES_FROM_BROWSER = String(process.env.YTDLP_COOKIES_FROM_BROWSER || "").trim();
// "auto" = biarkan yt-dlp pilih client sendiri (paling awet terhadap perubahan YouTube).
const YTDLP_PLAYER_CLIENT = String(process.env.YTDLP_PLAYER_CLIENT || "auto").trim();
// ytdl-core sudah lama tidak bisa membacakan format YouTube (butuh tambalannya
// sendiri), jadi yt-dlp dipakai sebagai jalur utama kecuali dinyalakan manual.
const USE_YTDLCORE = String(process.env.USE_YTDLCORE || "false").trim().toLowerCase() !== "false";
const DEFAULT_TONE_SPEED_MULTIPLIER = 2.325581;
const DEFAULT_TONE_AMP_DB = -2;
const DEFAULT_EXPORT_OGG_QUALITY = 8;
const PROCESS_SAMPLE_RATE = 44100;
const MIN_SPEED_MULTIPLIER = 0.25;
const MAX_SPEED_MULTIPLIER = 8;
const MIN_AMP_DB = -30;
const MAX_AMP_DB = 12;
const MIN_EXPORT_OGG_QUALITY = 0;
const MAX_EXPORT_OGG_QUALITY = 10;
const MAX_BATCH_UPLOAD_FILES = Number(process.env.MAX_BATCH_UPLOAD_FILES || 9999);
const MAX_COLLABORATORS = Number(process.env.MAX_COLLABORATORS || 15);
const ROBLOX_ASSET_PERMISSIONS_URL_TEMPLATE = String(process.env.ROBLOX_ASSET_PERMISSIONS_URL_TEMPLATE || "").trim();
const COLLAB_PERMISSION_RETRY_ON_404 = (process.env.COLLAB_PERMISSION_RETRY_ON_404 || "true").toLowerCase() !== "false";
const COLLAB_PERMISSION_RETRY_ATTEMPTS = Number(process.env.COLLAB_PERMISSION_RETRY_ATTEMPTS || 8);
const COLLAB_PERMISSION_RETRY_INTERVAL_MS = Number(process.env.COLLAB_PERMISSION_RETRY_INTERVAL_MS || 2500);
const UPLOAD_HISTORY_FILE = String(process.env.UPLOAD_HISTORY_FILE || path.join(process.cwd(), "upload-history.json")).trim();
const UPLOAD_HISTORY_MAX_ITEMS = Number(process.env.UPLOAD_HISTORY_MAX_ITEMS || 2000);
const ROBLOX_API_KEY_STORE_FILE = String(process.env.ROBLOX_API_KEY_STORE_FILE || path.join(process.cwd(), "roblox-api-key.json")).trim();
const API_KEYS_INTROSPECT_URL = "https://apis.roblox.com/api-keys/v1/introspect";
const API_KEY_INTROSPECTION_CACHE_TTL_MS = Number(process.env.API_KEY_INTROSPECTION_CACHE_TTL_MS || 5 * 60 * 1000);
const CORS_ALLOW_ORIGINS_RAW = String(process.env.CORS_ALLOW_ORIGINS || "*").trim();
const CORS_ALLOW_ORIGINS = CORS_ALLOW_ORIGINS_RAW.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const ADMIN_LOGIN_CODE = String(process.env.ADMIN_CODE || "whisky-admin").trim();
const AUTH_SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const AUTH_SESSIONS_FILE = String(process.env.AUTH_SESSIONS_FILE || path.join(process.cwd(), "auth-sessions.json")).trim();
const AUTH_USERS_FILE = String(process.env.AUTH_USERS_FILE || path.join(process.cwd(), "auth-users.json")).trim();
const USERNAME_PATTERN = /^[A-Za-z0-9 ._-]{2,32}$/;
const HISTORY_NO_USER_KEY = "tanpa-user";
const STUDIO_SETTINGS_FILE = String(process.env.STUDIO_SETTINGS_FILE || path.join(process.cwd(), "studio-settings.json")).trim();
const STUDIO_TARGET_SERVICES = new Set(["SoundService", "Workspace", "ReplicatedStorage"]);
const DEFAULT_STUDIO_SETTINGS = {
  studioPlaybackSpeed: "0.43",
  studioTargetService: "SoundService",
  studioFolderName: "BypassSounds",
  nameSuffix: "- BKB",
  autoUppercase: true,
  roundLabel: "",
  processingMode: "custom",
  changeSpeedValue: DEFAULT_TONE_SPEED_MULTIPLIER,
  exportOggQuality: DEFAULT_EXPORT_OGG_QUALITY,
  ampDb: DEFAULT_TONE_AMP_DB,
};
const DIST_DIR = path.join(process.cwd(), "dist");

let uploadHistoryWriteQueue = Promise.resolve();

let YTDL_AGENT = null;
let YTDL_COOKIES = null;
let ytdlAgentLoadAttempted = false;
let dynamicRobloxApiKey = null;
let robloxApiKeyLoadAttempted = false;
let apiKeyIntrospectionCache = {
  apiKey: null,
  payload: null,
  savedAt: 0,
};

app.use(express.json({ limit: "2mb" }));

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (!CORS_ALLOW_ORIGINS.length) return false;
  if (CORS_ALLOW_ORIGINS.includes("*")) return true;
  return CORS_ALLOW_ORIGINS.includes(origin);
}

app.use((req, res, next) => {
  const requestOrigin = String(req.headers.origin || "").trim();
  if (isOriginAllowed(requestOrigin)) {
    if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_BYTES,
  },
});

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, timeout };
}

function clearAbortTimeout(timeoutId) {
  clearTimeout(timeoutId);
}

async function runWithConcurrency(tasks, concurrency) {
  const limit = Math.max(1, Math.min(concurrency, tasks.length));
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (error) {
        results[currentIndex] = { __concurrencyError: true, error };
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeAssetName(value, { uppercase = true, suffix = "" } = {}) {
  const fallback = uppercase ? "WHISKY AUDIO" : "WHisky Audio";
  let cleaned = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9 \-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let trimmedSuffix = String(suffix || "").trim();
  if (trimmedSuffix) {
    if (!trimmedSuffix.startsWith("-") && !trimmedSuffix.startsWith("|") && !trimmedSuffix.startsWith("_")) {
      trimmedSuffix = `- ${trimmedSuffix}`;
    }
    const maxBaseLen = Math.max(3, 36 - trimmedSuffix.length - 1);
    if (cleaned.length > maxBaseLen) {
      cleaned = cleaned.slice(0, maxBaseLen).trim();
    }
    cleaned = `${cleaned} ${trimmedSuffix}`.trim();
  } else {
    cleaned = cleaned.slice(0, 36).trim();
  }

  if (uppercase) {
    cleaned = cleaned.toUpperCase();
  }

  if (!cleaned) return fallback;
  return cleaned.slice(0, 36).trim() || fallback;
}

function normalizeDescription(value) {
  const cleaned = String(value || "whis imut").trim();
  return cleaned || "whis imut";
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readUploadHistory() {
  try {
    const raw = await fs.readFile(UPLOAD_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
// Telegram integration removed

function parseDurationToken(rawToken) {
  const token = String(rawToken || "").trim().toLowerCase();
  const match = token.match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "d") return amount * 24 * 60 * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "m") return amount * 60 * 1000;
  return null;
}


function normalizeHistoryLimit(rawLimit, fallback = 80) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 500);
}

async function appendUploadHistory(entries, { batchLabel = "", batchId = "", username = "" } = {}) {
  if (!Array.isArray(entries) || !entries.length) return [];

  const uploaderName = String(username || "").trim();
  const uploaderKey = normalizeUsernameKey(uploaderName);

  const runWrite = async () => {
    const history = await readUploadHistory();
    let nextId = history.reduce((max, item) => {
      const value = Number(item?.uploadRecordId);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);

    const existingBatches = new Set(history.map((item) => item.batchLabel || item.batchId).filter(Boolean));
    const nextRoundNumber = existingBatches.size + 1;
    const finalBatchId = String(batchId || `batch-${Date.now()}`);
    const finalBatchLabel = String(batchLabel || `Ronde ${nextRoundNumber}`).trim();

    const savedEntries = entries.map((entry) => {
      nextId += 1;
      const now = new Date();
      return {
        uploadRecordId: nextId,
        uploadDate: getLocalDateKey(now),
        uploadedAt: now.toISOString(),
        username: entry.username || uploaderName || null,
        usernameKey: normalizeUsernameKey(entry.username) || uploaderKey || null,
        sourceType: entry.sourceType || "unknown",
        sourceName: entry.sourceName || null,
        sourceUrl: entry.sourceUrl || null,
        uploadedName: entry.uploadedName || null,
        assetId: entry.assetId ? String(entry.assetId) : null,
        operationId: entry.operationId ? String(entry.operationId) : null,
        batchId: entry.batchId || finalBatchId,
        batchLabel: entry.batchLabel || finalBatchLabel,
      };
    });

    const trimmedHistory = history
      .concat(savedEntries)
      .slice(-Math.max(10, Number.isFinite(UPLOAD_HISTORY_MAX_ITEMS) ? Math.floor(UPLOAD_HISTORY_MAX_ITEMS) : 2000));

    await writeDataFile(UPLOAD_HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
    return savedEntries;
  };

  const queuedWrite = uploadHistoryWriteQueue.then(runWrite);
  uploadHistoryWriteQueue = queuedWrite.catch(() => {});
  return queuedWrite;
}

function attachSavedUploadMeta({ uploadResults, savedEntries }) {
  if (!Array.isArray(uploadResults) || !Array.isArray(savedEntries) || !savedEntries.length) return;

  let savedIndex = 0;
  for (const item of uploadResults) {
    if (!item || !item.ok) continue;
    const saved = savedEntries[savedIndex];
    savedIndex += 1;
    if (!saved) continue;

    item.uploadRecordId = saved.uploadRecordId;
    item.uploadDate = saved.uploadDate;
    item.uploadedAt = saved.uploadedAt;
  }
}

async function updateUploadHistoryAssetId(uploadRecordId, assetId) {
  if (!uploadRecordId || !assetId) return;
  const runUpdate = async () => {
    const history = await readUploadHistory();
    let updated = false;
    for (const item of history) {
      if (Number(item.uploadRecordId) === Number(uploadRecordId) && (!item.assetId || item.assetId !== String(assetId))) {
        item.assetId = String(assetId);
        updated = true;
      }
    }
    if (updated) {
      await writeDataFile(UPLOAD_HISTORY_FILE, JSON.stringify(history, null, 2));
    }
  };

  const queued = uploadHistoryWriteQueue.then(runUpdate);
  uploadHistoryWriteQueue = queued.catch(() => {});
  return queued;
}

async function deleteUploadHistoryItem(recordId) {
  const targetId = Number(recordId);
  if (!Number.isFinite(targetId)) return false;

  const runDelete = async () => {
    const history = await readUploadHistory();
    const beforeCount = history.length;
    const filtered = history.filter((item) => Number(item.uploadRecordId) !== targetId);
    if (filtered.length !== beforeCount) {
      await writeDataFile(UPLOAD_HISTORY_FILE, JSON.stringify(filtered, null, 2));
      return true;
    }
    return false;
  };

  const queued = uploadHistoryWriteQueue.then(runDelete);
  uploadHistoryWriteQueue = queued.catch(() => {});
  return queued;
}

async function clearUploadHistory({ date = "", batch = "", username = "", all = false } = {}) {
  const runClear = async () => {
    const history = await readUploadHistory();
    let remaining = [];
    let deletedCount = 0;
    const targetUser = normalizeUsernameKey(username);

    if (all || (!date && !batch && !targetUser)) {
      remaining = [];
      deletedCount = history.length;
    } else {
      const targetBatch = String(batch).trim().toLowerCase();
      const targetDate = String(date).trim();

      remaining = history.filter((item) => {
        if (targetDate && item.uploadDate === targetDate) return false;
        if (targetBatch) {
          const itemBatchId = String(item.batchId || "").toLowerCase();
          const itemBatchLabel = String(item.batchLabel || "").toLowerCase();
          if (itemBatchId === targetBatch || itemBatchLabel === targetBatch) return false;
        }
        if (targetUser) {
          const itemUserKey = normalizeUsernameKey(item.username);
          if (targetUser === HISTORY_NO_USER_KEY ? !itemUserKey : itemUserKey === targetUser) return false;
        }
        return true;
      });
      deletedCount = history.length - remaining.length;
    }

    await writeDataFile(UPLOAD_HISTORY_FILE, JSON.stringify(remaining, null, 2));
    return { deletedCount, remainingCount: remaining.length };
  };

  const queued = uploadHistoryWriteQueue.then(runClear);
  uploadHistoryWriteQueue = queued.catch(() => {});
  return queued;
}

function scheduleBackgroundOperationResolver(operationId, uploadRecordId) {
  if (!operationId || !uploadRecordId) return;
  setTimeout(async () => {
    try {
      const assetId = await resolveAssetIdFromOperation(operationId, 35);
      if (assetId) {
        await updateUploadHistoryAssetId(uploadRecordId, assetId);
      }
    } catch {
      // background polling error ignored
    }
  }, 1000);
}

function loadDynamicRobloxApiKeySync() {
  try {
    const raw = readFileSync(ROBLOX_API_KEY_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const key = String(parsed?.robloxApiKey || "").trim();
    return key || null;
  } catch {
    return null;
  }
}

function getActiveRobloxApiKey() {
  if (!dynamicRobloxApiKey) {
    dynamicRobloxApiKey = loadDynamicRobloxApiKeySync();
  }
  const key = (dynamicRobloxApiKey || "").trim() || String(process.env.ROBLOX_API_KEY || "").trim();
  return key || null;
}

function getRobloxApiKey() {
  const key = getActiveRobloxApiKey();
  if (!key) {
    throw new Error("ROBLOX_API_KEY belum diisi. Isi via .env atau panel settings web.");
  }
  return key;
}

async function saveDynamicRobloxApiKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    throw new Error("API key Roblox tidak boleh kosong.");
  }

  await writeDataFile(
    ROBLOX_API_KEY_STORE_FILE,
    JSON.stringify({ robloxApiKey: key, updatedAt: new Date().toISOString() }, null, 2)
  );

  dynamicRobloxApiKey = key;
  process.env.ROBLOX_API_KEY = key;

  try {
    const envPath = path.join(process.cwd(), ".env");
    let envContent = await fs.readFile(envPath, "utf8");
    if (envContent.includes("ROBLOX_API_KEY=")) {
      envContent = envContent.replace(/^ROBLOX_API_KEY=.*$/m, `ROBLOX_API_KEY=${key}`);
    } else {
      envContent = `ROBLOX_API_KEY=${key}\n` + envContent;
    }
    await fs.writeFile(envPath, envContent, "utf8");
  } catch {
    // ignore .env write error
  }
}

async function clearDynamicRobloxApiKey() {
  try {
    await fs.unlink(ROBLOX_API_KEY_STORE_FILE);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      throw error;
    }
  }

  dynamicRobloxApiKey = null;
  process.env.ROBLOX_API_KEY = "";

  try {
    const envPath = path.join(process.cwd(), ".env");
    let envContent = await fs.readFile(envPath, "utf8");
    envContent = envContent.replace(/^ROBLOX_API_KEY=.*$/m, `ROBLOX_API_KEY=`);
    await fs.writeFile(envPath, envContent, "utf8");
  } catch {
    // ignore .env write error
  }
}

function getCreationContextFromEnv() {
  const groupId = String(process.env.ROBLOX_CREATOR_GROUP_ID || "").trim();
  const userId = String(process.env.ROBLOX_CREATOR_USER_ID || "").trim();

  if (groupId) {
    return {
      creator: {
        groupId,
      },
    };
  }

  if (userId) {
    return {
      creator: {
        userId,
      },
    };
  }

  return null;
}

function collectScopedIds(scopes, key) {
  const values = new Set();
  if (!Array.isArray(scopes)) return values;

  for (const scope of scopes) {
    if (!scope || typeof scope !== "object") continue;
    const rawList = Array.isArray(scope[key]) ? scope[key] : [];
    for (const item of rawList) {
      const normalized = String(item || "").trim();
      if (!normalized || normalized === "*") continue;
      values.add(normalized);
    }
  }

  return values;
}

async function introspectRobloxApiKey(rawApiKey, { force = false } = {}) {
  const apiKey = String(rawApiKey || "").trim();
  if (!apiKey) {
    throw new Error("API key Roblox tidak boleh kosong.");
  }

  const now = Date.now();
  const cacheAgeMs = now - Number(apiKeyIntrospectionCache.savedAt || 0);
  const canUseCache =
    !force &&
    apiKeyIntrospectionCache.apiKey === apiKey &&
    apiKeyIntrospectionCache.payload &&
    cacheAgeMs >= 0 &&
    cacheAgeMs < Math.max(30000, API_KEY_INTROSPECTION_CACHE_TTL_MS);

  if (canUseCache) {
    return apiKeyIntrospectionCache.payload;
  }

  const { signal, timeout } = createAbortSignal(Math.min(Math.max(REQUEST_TIMEOUT_MS, 15000), 30000));
  try {
    const response = await fetch(API_KEYS_INTROSPECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ apiKey }),
      signal,
    });

    const payload = await parseResponseBody(response);
    if (!response.ok || !payload || typeof payload !== "object") {
      const message = payload && payload.message ? payload.message : `Gagal introspect API key (HTTP ${response.status}).`;
      throw new Error(message);
    }

    apiKeyIntrospectionCache = {
      apiKey,
      payload,
      savedAt: now,
    };

    return payload;
  } finally {
    clearAbortTimeout(timeout);
  }
}

async function resolveCreatorContextFromApiKey(apiKey) {
  const introspection = await introspectRobloxApiKey(apiKey);
  const authorizedUserId = String(introspection?.authorizedUserId || "").trim();
  const scopedGroupIds = Array.from(collectScopedIds(introspection?.scopes, "groupIds"));
  const scopedUserIds = Array.from(collectScopedIds(introspection?.scopes, "userIds"));

  let selectedCreator = null;
  let source = "api-key-authorized-user";

  if (scopedGroupIds.length > 0) {
    selectedCreator = { type: "group", id: scopedGroupIds[0] };
    source = "api-key-scope-group";
  } else if (scopedUserIds.length > 0) {
    selectedCreator = { type: "user", id: scopedUserIds[0] };
    source = "api-key-scope-user";
  } else if (authorizedUserId) {
    selectedCreator = { type: "user", id: authorizedUserId };
  }

  if (!selectedCreator) {
    return {
      ok: false,
      message: "Creator tidak bisa ditentukan dari API key. Isi creator user/group ID manual di .env.",
      introspection,
      source: "unknown",
      creatorProfile: null,
      creationContext: null,
      scopedGroupIds,
      scopedUserIds,
      authorizedUserId: authorizedUserId || null,
    };
  }

  const creatorProfile = await fetchCreatorProfile({
    creatorUserId: selectedCreator.type === "user" ? selectedCreator.id : "",
    creatorGroupId: selectedCreator.type === "group" ? selectedCreator.id : "",
  });

  return {
    ok: true,
    message: "Creator berhasil diambil dari API key.",
    introspection,
    source,
    creatorProfile,
    creationContext:
      selectedCreator.type === "group"
        ? { creator: { groupId: selectedCreator.id } }
        : { creator: { userId: selectedCreator.id } },
    scopedGroupIds,
    scopedUserIds,
    authorizedUserId: authorizedUserId || null,
  };
}

async function getCreationContext() {
  const envContext = getCreationContextFromEnv();
  if (envContext) return envContext;

  const apiKey = getRobloxApiKey();
  const inferred = await resolveCreatorContextFromApiKey(apiKey);
  if (inferred?.creationContext) {
    return inferred.creationContext;
  }

  throw new Error(
    "Creator belum disetel. Isi ROBLOX_CREATOR_USER_ID/ROBLOX_CREATOR_GROUP_ID atau gunakan API key yang bisa di-introspect."
  );
}

function getFileNameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const fromPath = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (fromPath) return fromPath;
    return "imported-audio.mp3";
  } catch {
    return "imported-audio.mp3";
  }
}

function getMimeType(fileName, explicitType) {
  if (explicitType && AUDIO_CONTENT_TYPES.includes(explicitType.toLowerCase())) {
    return explicitType;
  }

  const ext = path.extname(fileName || "").toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".webm") return "audio/webm";
  return "application/octet-stream";
}

function isAudioLikeUrl(rawUrl) {
  return /\.(mp3|wav|ogg|flac|m4a|aac|webm)(\?.*)?$/i.test(String(rawUrl || "").trim());
}

function isYouTubeUrl(rawUrl) {
  return /(youtube\.com|youtu\.be)/i.test(String(rawUrl || "").trim());
}

// ID video YouTube versi ytdl-core wajib 11 karakter
const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9-_]{11}$/;

function extractYouTubeVideoId(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  let url;
  try {
    url = new URL(text);
  } catch {
    // bukan URL, mungkin memang ID polos
    return YOUTUBE_VIDEO_ID_PATTERN.test(text) ? text : "";
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return segments[0] || "";

  const fromQuery = url.searchParams.get("v") || "";
  if (fromQuery) return fromQuery;

  const markerIndex = segments.findIndex((segment) => ["shorts", "embed", "live", "v"].includes(segment.toLowerCase()));
  if (markerIndex >= 0 && segments[markerIndex + 1]) return segments[markerIndex + 1];

  return "";
}

// YouTube sekarang kadang mengeluarkan ID kurang dari 11 karakter, sementara ytdl-core
// memaksa pola 11 karakter. Link pendek youtu.be juga harus diikuti redirect-nya
// supaya ketahuan ID aslinya (dan bentuknya jadi watch?v= yang paling dimengerti tool).
async function resolveYouTubeWatchUrl(rawUrl) {
  const original = String(rawUrl || "").trim();
  let candidate = extractYouTubeVideoId(original);

  if (!candidate && original) {
    const { signal, timeout } = createAbortSignal(15000);
    try {
      const response = await fetch(original, {
        method: "GET",
        redirect: "follow",
        signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      candidate = extractYouTubeVideoId(response.url || "") || "";
    } catch {
      // biarkan kosong, error yang menjelaskan
    } finally {
      clearAbortTimeout(timeout);
    }
  }

  if (!candidate) {
    throw new Error(
      `Link YouTube tidak dikenali ("${original}"). Salin ulang link dari tombol Bagikan di YouTube.`
    );
  }

  return { videoId: candidate, watchUrl: `https://www.youtube.com/watch?v=${candidate}` };
}

function sanitizeFileStem(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/ /g, "-") || "youtube-audio";
}

function guessExtensionFromMimeType(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("audio/mp4") || type.includes("audio/x-m4a")) return ".m4a";
  if (type.includes("audio/webm")) return ".webm";
  if (type.includes("audio/ogg")) return ".ogg";
  if (type.includes("audio/wav")) return ".wav";
  if (type.includes("audio/flac")) return ".flac";
  if (type.includes("audio/mpeg") || type.includes("audio/mp3")) return ".mp3";
  return ".webm";
}

function secondsToClock(totalSeconds) {
  const clamped = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDurationFromFfmpegLog(stderrText) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(String(stderrText || ""));
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);

  if (![hours, minutes, seconds].every((value) => Number.isFinite(value))) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

async function probeAudioDurationSeconds({ buffer, fileName }) {
  if (!FFMPEG_BINARY) {
    throw new Error("FFmpeg tidak ditemukan. Install dependency ffmpeg-static atau isi FFMPEG_PATH.");
  }

  const sourceExt = path.extname(fileName || "").toLowerCase();
  const inputExt = AUDIO_EXTENSIONS.has(sourceExt) ? sourceExt : ".mp3";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bypas-musik-probe-"));
  const inputPath = path.join(tempDir, `source${inputExt}`);

  await fs.writeFile(inputPath, buffer);

  try {
    const stderr = await new Promise((resolve, reject) => {
      const child = spawn(FFMPEG_BINARY, ["-hide_banner", "-i", inputPath], { windowsHide: true });
      let captured = "";

      child.stderr.on("data", (chunk) => {
        if (captured.length < 10000) {
          captured += String(chunk);
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Gagal menjalankan FFmpeg saat cek durasi: ${error.message}`));
      });

      child.on("close", (_code) => {
        resolve(captured);
      });
    });

    const durationSeconds = parseDurationFromFfmpegLog(stderr);
    if (!durationSeconds || !Number.isFinite(durationSeconds)) {
      throw new Error("Durasi audio tidak bisa dibaca dari file sumber.");
    }

    return durationSeconds;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function enforceRobloxAudioLimits({ buffer, fileName }) {
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error(`Ukuran audio melebihi batas ${Math.floor(MAX_AUDIO_BYTES / (1024 * 1024))} MB.`);
  }

  if (MAX_AUDIO_SECONDS <= 0) return;

  const durationSeconds = await probeAudioDurationSeconds({ buffer, fileName });
  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error(
      `Durasi audio ${secondsToClock(durationSeconds)} melebihi batas Roblox ${secondsToClock(MAX_AUDIO_SECONDS)}.`
    );
  }
}

function toYouTubeFriendlyError(error) {
  const raw = error instanceof Error ? error.message : String(error || "Unknown YouTube error");
  const lowered = raw.toLowerCase();

  if (lowered.includes("failed to find any playable formats")) {
    return "YouTube tidak memberikan format audio yang bisa diputar. Biasanya karena video private, age-restricted, region-locked, livestream tertentu, atau perlu cookies akun.";
  }

  if (lowered.includes("status code: 429") || lowered.includes("too many requests")) {
    return "YouTube sedang rate-limit server kamu (429). Tunggu beberapa saat, ganti IP/proxy, atau pakai cookies akun.";
  }

  if (lowered.includes("status code: 403") || lowered.includes("forbidden")) {
    return "Akses ke stream YouTube ditolak (403). Coba video lain atau gunakan cookies akun YouTube lewat YTDL_COOKIES_JSON.";
  }

  if (lowered.includes("does not match expected format")) {
    return "Link YouTube-nya tidak lengkap / bukan link video yang benar (ID video harus 11 karakter). Buka video-nya di YouTube, tekan Bagikan > Salin link, lalu tempel ulang.";
  }

  if (lowered.includes("no video id found") || lowered.includes("not a youtube domain")) {
    return "Itu bukan link video YouTube (link lain tidak bisa diimpor). Pakai link youtube.com/watch?v=... atau youtu.be/...";
  }

  if (lowered.includes("video unavailable")) {
    return "Video YouTube-nya tidak bisa diakses (hapus, private, atau diblokir di negara/server).";
  }

  if (lowered.includes("status code: 410")) {
    return "Stream YouTube sudah tidak tersedia (410). Coba link video lain yang masih aktif.";
  }

  return `Gagal mengambil audio YouTube: ${raw}`;
}

function toYtDlpFriendlyError(error) {
  const messageParts = [];

  if (error && typeof error === "object") {
    const typed = error;
    if (typed.stderr) messageParts.push(String(typed.stderr));
    if (typed.shortMessage) messageParts.push(String(typed.shortMessage));
    if (typed.message) messageParts.push(String(typed.message));
  } else {
    messageParts.push(String(error || "Unknown yt-dlp error"));
  }

  const raw = messageParts.filter(Boolean).join(" | ");
  const lowered = raw.toLowerCase();

  if (lowered.includes("looks truncated") || lowered.includes("incomplete youtube id")) {
    return "Link YouTube-nya kepotong, ID video tidak lengkap. Buka video-nya di YouTube lalu Bagikan > Salin link, tempel yang penuh (ID video 11 karakter).";
  }

  if (lowered.includes("private video")) {
    return "Video YouTube private, jadi tidak bisa diambil audionya dari backend.";
  }

  if (lowered.includes("sign in to confirm") || lowered.includes("age-restricted")) {
    return "Video YouTube butuh login/age confirmation. Coba pakai cookies akun yang masih aktif.";
  }

  if (lowered.includes("requested format is not available")) {
    return "Format audio terbaik tidak tersedia dari YouTube untuk video ini. Coba aktifkan cookies browser lewat YTDLP_COOKIES_FROM_BROWSER=chrome atau coba video lain.";
  }

  if (lowered.includes("page needs to be reloaded")) {
    return "YouTube menolak client player yang dipakai (biasanya client tv/android yang sudah tidak didukung). yt-dlp sudah otomatis coba client lain; kalau masih gagal, set YTDLP_PLAYER_CLIENT=web_safari.";
  }

  if (lowered.includes("could not copy chrome cookie database")) {
    return "yt-dlp tidak bisa baca cookie Chrome saat browser masih aktif. Tutup semua jendela Chrome, atau pakai YTDL_COOKIES_FILE=./cookies.json.";
  }

  if (lowered.includes("429") || lowered.includes("too many requests")) {
    return "YouTube membatasi request dari server kamu (429). Coba lagi nanti atau pakai IP/proxy lain.";
  }

  if (lowered.includes("python3") || lowered.includes("no such file or directory") || lowered.includes("enoent")) {
    return "Binary yt-dlp di server ini tidak bisa dijalankan (butuh Python atau belum terunduh). Pulihkan dengan: node scripts/fetch-yt-dlp.mjs";
  }

  const detail = raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
  return `Fallback yt-dlp gagal: ${detail || "tanpa detail error"}`;
}

function cookiesToNetscape(cookies) {
  const header = ["# Netscape HTTP Cookie File", "# This file is generated by bypas-musik backend", ""];

  const lines = cookies
    .filter((cookie) => cookie && typeof cookie === "object" && cookie.name && cookie.value !== undefined)
    .map((cookie) => {
      const domain = String(cookie.domain || "").trim() || ".youtube.com";
      const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
      const pathValue = String(cookie.path || "/");
      const secure = cookie.secure ? "TRUE" : "FALSE";
      const expiry = cookie.session
        ? "0"
        : String(Number.isFinite(cookie.expirationDate) ? Math.floor(Number(cookie.expirationDate)) : 0);
      const name = String(cookie.name);
      const value = String(cookie.value || "");

      return [domain, includeSubdomains, pathValue, secure, expiry, name, value].join("\t");
    });

  return header.concat(lines).join("\n");
}

async function ensureYtdlAgentLoaded() {
  if (ytdlAgentLoadAttempted) return;
  ytdlAgentLoadAttempted = true;

  let rawCookies = YTDL_COOKIES_JSON;

  if (!rawCookies) {
    const candidateFile = YTDL_COOKIES_FILE || path.join(process.cwd(), "cookies.json");
    try {
      rawCookies = await fs.readFile(candidateFile, "utf8");
    } catch {
      rawCookies = "";
    }
  }

  if (!rawCookies) return;

  try {
    const parsed = JSON.parse(rawCookies);
    if (Array.isArray(parsed) && parsed.length > 0) {
      YTDL_COOKIES = parsed;
      YTDL_AGENT = ytdl.createAgent(parsed);
    }
  } catch {
    console.warn("Cookie YouTube tidak valid. Cek YTDL_COOKIES_JSON atau file cookies.json.");
  }
}

async function getYouTubeCookieStatus() {
  await ensureYtdlAgentLoaded();

  if (Array.isArray(YTDL_COOKIES) && YTDL_COOKIES.length > 0) {
    const source = YTDL_COOKIES_JSON
      ? "env-json"
      : YTDL_COOKIES_FILE
        ? "env-file"
        : "cookies.json";

    return {
      enabled: true,
      source,
      count: YTDL_COOKIES.length,
    };
  }

  if (YTDLP_COOKIES_FROM_BROWSER) {
    return {
      enabled: true,
      source: `browser:${YTDLP_COOKIES_FROM_BROWSER}`,
      count: null,
    };
  }

  return {
    enabled: false,
    source: "none",
    count: 0,
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = Math.min(REQUEST_TIMEOUT_MS, 15000)) {
  const { signal, timeout } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearAbortTimeout(timeout);
  }
}

function getCreatorProfileUrl({ type, id }) {
  if (!type || !id) return null;
  if (type === "user") return `https://www.roblox.com/users/${id}/profile`;
  if (type === "group") return `https://www.roblox.com/groups/${id}`;
  return null;
}

async function fetchCreatorProfile({ creatorUserId, creatorGroupId }) {
  if (creatorUserId) {
    const userData = await fetchJsonWithTimeout(`https://users.roblox.com/v1/users/${encodeURIComponent(creatorUserId)}`);
    const thumbData = await fetchJsonWithTimeout(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(
        creatorUserId
      )}&size=150x150&format=Png&isCircular=false`
    );

    return {
      type: "user",
      id: creatorUserId,
      name: userData?.name || null,
      displayName: userData?.displayName || userData?.name || null,
      avatarUrl: thumbData?.data?.[0]?.imageUrl || null,
      url: getCreatorProfileUrl({ type: "user", id: creatorUserId }),
    };
  }

  if (creatorGroupId) {
    const groupData = await fetchJsonWithTimeout(
      `https://groups.roblox.com/v1/groups/${encodeURIComponent(creatorGroupId)}`
    );
    const thumbData = await fetchJsonWithTimeout(
      `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${encodeURIComponent(
        creatorGroupId
      )}&size=150x150&format=Png&isCircular=false`
    );

    return {
      type: "group",
      id: creatorGroupId,
      name: groupData?.name || null,
      displayName: groupData?.name || null,
      avatarUrl: thumbData?.data?.[0]?.imageUrl || null,
      url: getCreatorProfileUrl({ type: "group", id: creatorGroupId }),
    };
  }

  return null;
}

async function getYouTubeInfoWithFallback(rawUrl) {
  await ensureYtdlAgentLoaded();

  const attempts = [
    ["ANDROID", "IOS", "TV", "WEB_EMBEDDED"],
    ["TV", "IOS"],
    ["ANDROID"],
  ];

  let lastError = null;

  for (const playerClients of attempts) {
    try {
      return await ytdl.getInfo(rawUrl, {
        playerClients,
        agent: YTDL_AGENT || undefined,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Gagal mengambil metadata YouTube.");
}

async function resolveYtDlpCookiesFile(tempDir) {
  await ensureYtdlAgentLoaded();

  if (Array.isArray(YTDL_COOKIES) && YTDL_COOKIES.length > 0) {
    const generatedPath = path.join(tempDir, "youtube-cookies.txt");
    await fs.writeFile(generatedPath, cookiesToNetscape(YTDL_COOKIES), "utf8");
    return generatedPath;
  }

  const directFile = YTDL_COOKIES_FILE || DEFAULT_COOKIES_FILE_PATH;
  try {
    await fs.access(directFile);
    return directFile;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// yt-dlp: binary standalone (tanpa Python) hasil scripts/fetch-yt-dlp.mjs
// ---------------------------------------------------------------------------
const YTDLP_ASSET_NAME =
  String(process.env.YTDLP_ASSET || "").trim() ||
  (process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux");

const YTDLP_CANDIDATE_PATHS = [
  String(process.env.YTDLP_BINARY || "").trim(),
  path.join(process.cwd(), "bin", YTDLP_ASSET_NAME),
  path.join(process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
  path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", YTDLP_ASSET_NAME),
].filter(Boolean);

async function resolveYtDlpBinary() {
  for (const candidate of YTDLP_CANDIDATE_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

// Cek isi binary: versi script butuh python3, versi standalone tidak
let cachedYtDlpVersion = null;

async function readYtDlpVersion(binaryPath) {
  if (cachedYtDlpVersion) return cachedYtDlpVersion;
  try {
    const { stdout } = await runYtDlp(binaryPath, ["--version"], 20000);
    cachedYtDlpVersion = stdout.trim().split("\n").pop().trim();
  } catch {
    cachedYtDlpVersion = "tidak diketahui";
  }
  return cachedYtDlpVersion;
}

async function getYouTubeToolStatus() {
  const binaryPath = await resolveYtDlpBinary();
  const status = {
    file: binaryPath || YTDLP_CANDIDATE_PATHS[1] || YTDLP_ASSET_NAME,
    name: path.basename(binaryPath || YTDLP_ASSET_NAME),
    exists: Boolean(binaryPath),
    standalone: false,
    needsPython: false,
    version: null,
    playerClients: YTDLP_PLAYER_CLIENT === "auto" ? "auto" : YTDLP_PLAYER_CLIENT,
  };

  if (!binaryPath) return status;

  try {
    const handle = await fs.open(binaryPath, "r");
    try {
      const buffer = Buffer.alloc(128);
      const { bytesRead } = await handle.read(buffer, 0, 128, 0);
      const head = buffer.subarray(0, bytesRead).toString("utf8");
      status.needsPython = head.startsWith("#!") && /python/i.test(head);
      status.standalone = !status.needsPython;
    } finally {
      await handle.close();
    }
  } catch {
    // tidak bisa dibaca, biarkan status apa adanya
  }

  status.version = await readYtDlpVersion(binaryPath);
  return status;
}

function buildYtDlpArgs(flags) {
  const args = [];
  const addFlag = (name, value) => {
    if (value === undefined || value === null || value === false || value === "") return;
    if (value === true) args.push(`--${name}`);
    else args.push(`--${name}`, String(value));
  };

  addFlag("no-playlist", flags.noPlaylist);
  addFlag("no-warnings", flags.noWarnings);
  addFlag("no-check-certificate", flags.noCheckCertificate);
  addFlag("geo-bypass", flags.geoBypass);
  addFlag("sleep-requests", flags.sleepRequests);
  addFlag("output", flags.output);
  addFlag("restrict-filenames", flags.restrictFilenames);
  addFlag("ffmpeg-location", flags.ffmpegLocation);
  addFlag("cookies", flags.cookies);
  addFlag("cookies-from-browser", flags.cookiesFromBrowser);
  addFlag("extractor-args", flags.extractorArgs);
  addFlag("force-ipv4", flags.forceIpv4);
  addFlag("format", flags.format);
  addFlag("extract-audio", flags.extractAudio);
  addFlag("audio-format", flags.audioFormat);
  addFlag("audio-quality", flags.audioQuality);

  return args;
}

function runYtDlp(binaryPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binaryPath, args, { windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // child sudah mati
      }
      reject(new Error(`yt-dlp berhenti setelah ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      const wrapped = new Error(`Gagal menjalankan yt-dlp: ${error.message}`);
      wrapped.stderr = error.message;
      reject(wrapped);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`yt-dlp keluar dengan kode ${code}.`);
      error.stderr = stderr || stdout;
      error.shortMessage = stderr || stdout;
      error.exitCode = code;
      reject(error);
    });
  });
}

// yt-dlp versi 2025+ sudah membuang client android/ios lama, dan client tv sering
// bikin error "The page needs to be reloaded" kalau cookie berasal dari jaringan
// lain (misalnya cookie laptop dipakai di server Railway). Jadi urutan coba:
// client default -> web_safari -> mweb -> web_embedded, masing-masing dengan dan
// tanpa cookie.
const YTDLP_FALLBACK_CLIENTS = ["web_safari", "mweb", "web_embedded"];

function ytDlpPlayerArg(spec) {
  const value = String(spec || "").trim();
  // kosong = tidak mengirim --extractor-args, biarkan yt-dlp pakai urutan default-nya
  return value ? `youtube:player_client=${value}` : undefined;
}

function buildYtDlpClientSpecs() {
  const configured = YTDLP_PLAYER_CLIENT && YTDLP_PLAYER_CLIENT !== "auto" ? YTDLP_PLAYER_CLIENT : "";
  const specs = [];
  const add = (value) => {
    const cleaned = String(value || "").trim();
    if (!cleaned && specs.includes("")) return;
    if (specs.includes(cleaned)) return;
    specs.push(cleaned);
  };

  add(configured);
  add("");
  for (const client of YTDLP_FALLBACK_CLIENTS) add(client);
  return specs;
}

const YTDLP_AUDIO_FORMATS = [
  "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best",
  "ba/b",
];

// Daftar strategi yang dicoba, dari yang paling sering berhasil di server datacenter.
// Cookie sengaja dicoba belakangan: IP server yang sudah ditandai bot membuat cookie
// justru memicu "butuh login", sementara tanpa cookie sering lolos.
function buildYtDlpStrategies(cookiesPath, tempDir) {
  const clientSpecs = buildYtDlpClientSpecs();
  const strategies = [];

  for (const spec of clientSpecs) {
    strategies.push({
      label: `client=${spec || "auto"} tanpa cookie`,
      extractorArgs: ytDlpPlayerArg(spec),
    });
  }

  if (cookiesPath) {
    for (const spec of clientSpecs) {
      strategies.push({
        label: `client=${spec || "auto"} pakai cookie`,
        extractorArgs: ytDlpPlayerArg(spec),
        cookies: cookiesPath,
      });
    }
  }

  return strategies.map((strategy) => ({
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificate: true,
    geoBypass: true,
    sleepRequests: "0.5",
    output: path.join(tempDir, "%(title).70B.%(ext)s"),
    restrictFilenames: true,
    ffmpegLocation: FFMPEG_BINARY || undefined,
    forceIpv4: true,
    ...strategy,
  }));
}

function ytDlpErrorDetail(error) {
  const text = [error && error.stderr ? String(error.stderr) : "", error && error.message ? String(error.message) : ""]
    .filter(Boolean)
    .join(" ");

  // baris ERROR pertama biasanya paling menjelaskan; sisanya dipotong di belakang
  const errorLine = text.split(/\r?\n/).find((line) => line.includes("ERROR")) || "";
  const tail = text.slice(-160);

  return `${errorLine.trim()} ${errorLine && tail.includes(errorLine.trim()) ? "" : tail}`.trim().slice(0, 300);
}

async function probeYouTubeStrategies(rawUrl) {
  const binaryPath = await resolveYtDlpBinary();
  if (!binaryPath) {
    throw new Error("yt-dlp belum ada di server. Jalankan: node scripts/fetch-yt-dlp.mjs");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bypas-musik-probe-"));
  try {
    const cookiesPath = await resolveYtDlpCookiesFile(tempDir);
    const strategies = buildYtDlpStrategies(cookiesPath, tempDir);
    const results = [];

    for (const strategy of strategies) {
      const startedAt = Date.now();
      let lastDetail = "";
      let ok = false;

      for (const format of YTDLP_AUDIO_FORMATS) {
        try {
          const { stdout } = await runYtDlp(
            binaryPath,
            [
              ...buildYtDlpArgs({
                ...strategy,
                format,
                output: path.join(tempDir, "probe-%(id)s.%(ext)s"),
              }),
              "--print",
              "after_video:filename",
              rawUrl,
            ],
            60000
          );
          ok = true;
          lastDetail = `${format} -> ${stdout.trim().split("\n").pop() || "oke"}`;
          break;
        } catch (error) {
          lastDetail = `${format}: ${ytDlpErrorDetail(error)}`;
        }
      }

      results.push({ label: strategy.label, ok, detail: lastDetail, ms: Date.now() - startedAt });
    }

    return {
      binary: path.basename(binaryPath),
      cookieCount: Array.isArray(YTDL_COOKIES) ? YTDL_COOKIES.length : 0,
      playerClientConfig: YTDLP_PLAYER_CLIENT,
      results,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function downloadYouTubeAudioWithYtDlp(rawUrl) {
  const binaryPath = await resolveYtDlpBinary();
  if (!binaryPath) {
    throw new Error(
      "yt-dlp belum ada di server (binary standalone tidak ketemu). Jalankan: node scripts/fetch-yt-dlp.mjs"
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bypas-musik-ytdlp-"));

  try {
    const cookiesPath = await resolveYtDlpCookiesFile(tempDir);
    const strategies = buildYtDlpStrategies(cookiesPath, tempDir);
    if (YTDLP_COOKIES_FROM_BROWSER && !cookiesPath) {
      strategies.forEach((strategy) => {
        strategy.cookiesFromBrowser = YTDLP_COOKIES_FROM_BROWSER;
      });
    }

    const failures = [];
    let lastError = null;

    for (const strategy of strategies) {
      let strategyError = null;

      for (const format of YTDLP_AUDIO_FORMATS) {
        try {
          await runYtDlp(binaryPath, [...buildYtDlpArgs({ ...strategy, format }), rawUrl], Math.max(REQUEST_TIMEOUT_MS, 180000));
          strategyError = null;
          break;
        } catch (error) {
          strategyError = error;
        }
      }

      if (!strategyError) {
        failures.length = 0;
        lastError = null;
        break;
      }

      lastError = strategyError;
      failures.push(`${strategy.label}: ${ytDlpErrorDetail(strategyError)}`);
    }

    if (lastError) {
      lastError.stderr = `${failures.join(" ; ").slice(0, 700)} || ${String(lastError.stderr || "")}`;
      throw lastError;
    }

    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !name.endsWith(".part") && !name.endsWith(".ytdl") && !name.endsWith(".txt"));

    if (!candidates.length) {
      throw new Error("yt-dlp tidak menghasilkan file audio.");
    }

    const selectedName = candidates[0];
    const selectedPath = path.join(tempDir, selectedName);
    const buffer = await fs.readFile(selectedPath);

    if (!buffer.length) {
      throw new Error("yt-dlp menghasilkan file kosong.");
    }

    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new Error(`Ukuran audio melebihi batas ${Math.floor(MAX_AUDIO_BYTES / (1024 * 1024))} MB.`);
    }

    return {
      buffer,
      fileName: selectedName,
      contentType: getMimeType(selectedName, ""),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function readStreamToBuffer(stream, sizeLimitBytes, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const timeoutId = setTimeout(() => {
      stream.destroy(new Error(`Waktu unduh audio habis (${timeoutMs} ms).`));
    }, timeoutMs);

    stream.on("data", (chunk) => {
      total += chunk.length;

      if (total > sizeLimitBytes) {
        stream.destroy(new Error(`Ukuran audio melebihi batas ${Math.floor(sizeLimitBytes / (1024 * 1024))} MB.`));
        return;
      }

      chunks.push(chunk);
    });

    stream.on("end", () => {
      clearTimeout(timeoutId);
      resolve(Buffer.concat(chunks));
    });

    stream.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function downloadYouTubeAudio(rawUrl) {
  if (!isYouTubeUrl(rawUrl)) {
    throw new Error("URL YouTube tidak valid untuk mode youtube-proxy.");
  }

  const { videoId, watchUrl } = await resolveYouTubeWatchUrl(rawUrl);

  // ID bukan 11 karakter tidak akan pernah bisa dibaca ytdl-core, jadi langsung yt-dlp.
  if (!USE_YTDLCORE || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    try {
      return await downloadYouTubeAudioWithYtDlp(watchUrl);
    } catch (fallbackError) {
      throw new Error(toYtDlpFriendlyError(fallbackError));
    }
  }

  let info;
  try {
    info = await getYouTubeInfoWithFallback(watchUrl);
  } catch (error) {
    try {
      return await downloadYouTubeAudioWithYtDlp(watchUrl);
    } catch (fallbackError) {
      throw new Error(`${toYouTubeFriendlyError(error)} ${toYtDlpFriendlyError(fallbackError)}`);
    }
  }

  const audioFormats = ytdl.filterFormats(info.formats, "audioonly");

  if (!audioFormats.length) {
    try {
      return await downloadYouTubeAudioWithYtDlp(watchUrl);
    } catch (fallbackError) {
      throw new Error(
        `Audio stream YouTube tidak ditemukan dari ytdl-core. ${toYtDlpFriendlyError(fallbackError)}`
      );
    }
  }

  const selectedFormat = ytdl.chooseFormat(audioFormats, { quality: "highestaudio" });
  const mimeType = String(selectedFormat.mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
  const ext = guessExtensionFromMimeType(mimeType);
  const titleStem = sanitizeFileStem(info.videoDetails?.title || "youtube-audio");
  const fileName = `${titleStem}${ext}`;

  const stream = ytdl.downloadFromInfo(info, {
    format: selectedFormat,
    highWaterMark: 1 << 25,
    agent: YTDL_AGENT || undefined,
  });

  try {
    const buffer = await readStreamToBuffer(stream, MAX_AUDIO_BYTES, REQUEST_TIMEOUT_MS);

    return {
      buffer,
      fileName,
      contentType: getMimeType(fileName, mimeType),
    };
  } catch (error) {
    try {
      return await downloadYouTubeAudioWithYtDlp(rawUrl);
    } catch (fallbackError) {
      throw new Error(`${toYouTubeFriendlyError(error)} ${toYtDlpFriendlyError(fallbackError)}`);
    }
  }
}

function parseBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function parseNumberInRange(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function resolveProcessingMode({ requestedMode, applyToneMatch }) {
  const normalized = String(requestedMode || "").trim().toLowerCase();
  if (["ori", "original", "none", "off"].includes(normalized)) return "ori";
  if (["custom", "tone-match", "whis-tone-match", "on"].includes(normalized)) return "custom";
  return applyToneMatch ? "custom" : "ori";
}

function buildAudioProcessSettings(payload) {
  const speedMultiplier = parseNumberInRange(
    payload?.changeSpeedValue ?? payload?.changeSpeed ?? payload?.speed,
    DEFAULT_TONE_SPEED_MULTIPLIER,
    MIN_SPEED_MULTIPLIER,
    MAX_SPEED_MULTIPLIER
  );
  const exportOggQuality = Math.round(
    parseNumberInRange(
      payload?.exportOggQuality ?? payload?.oggQuality,
      DEFAULT_EXPORT_OGG_QUALITY,
      MIN_EXPORT_OGG_QUALITY,
      MAX_EXPORT_OGG_QUALITY
    )
  );
  const ampDb = parseNumberInRange(
    payload?.ampDb ?? payload?.amp,
    DEFAULT_TONE_AMP_DB,
    MIN_AMP_DB,
    MAX_AMP_DB
  );

  return {
    changeSpeedValue: Number(speedMultiplier.toFixed(6)),
    exportOggQuality,
    ampDb: Number(ampDb.toFixed(3)),
  };
}

function parseCollaboratorTokens(rawValue) {
  const base = Array.isArray(rawValue) ? rawValue.join("\n") : String(rawValue || "");
  const unique = new Set();

  for (const item of base.split(/[\n,;]+/)) {
    const normalized = String(item || "").trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return Array.from(unique);
}

function parseCollaborationConfig(payload) {
  const enabled = parseBooleanFlag(payload?.enableCollaboration ?? payload?.collaborationEnabled, false);
  const mode = String(payload?.collaborationMode || "none").trim().toLowerCase();

  if (!enabled || mode !== "connection") {
    return {
      enabled: false,
      mode: "none",
      rawTargets: [],
      warnings: [],
    };
  }

  const rawTargets = parseCollaboratorTokens(payload?.collaboratorTargets ?? payload?.collaborators);
  const warnings = [];

  if (rawTargets.length > MAX_COLLABORATORS) {
    warnings.push(`Target kolaborator dipotong ke ${MAX_COLLABORATORS} akun per request.`);
  }

  return {
    enabled: true,
    mode: "connection",
    rawTargets: rawTargets.slice(0, MAX_COLLABORATORS),
    warnings,
  };
}

function parseImportUrlTargets(payload) {
  const combined = [];

  if (Array.isArray(payload?.urls)) combined.push(...payload.urls);
  if (typeof payload?.urls === "string") combined.push(payload.urls);
  if (payload?.url !== undefined && payload?.url !== null) combined.push(payload.url);

  const unique = new Set();
  for (const item of combined) {
    for (const token of String(item || "").split(/[\n,;]+/)) {
      const normalized = String(token || "").trim();
      if (!normalized) continue;
      unique.add(normalized);
    }
  }

  return Array.from(unique).slice(0, MAX_BATCH_UPLOAD_FILES);
}

async function resolveUserIdsFromUsernames(usernames) {
  if (!Array.isArray(usernames) || !usernames.length) return { resolved: new Map(), missing: [] };

  const { signal, timeout } = createAbortSignal(Math.min(REQUEST_TIMEOUT_MS, 15000));

  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        usernames,
        excludeBannedUsers: false,
      }),
      signal,
    });

    const payload = await parseResponseBody(response);
    const resolved = new Map();

    if (response.ok && Array.isArray(payload?.data)) {
      for (const user of payload.data) {
        const key = String(user.requestedUsername || user.name || "").trim().toLowerCase();
        const id = String(user.id || "").trim();
        if (!key || !id) continue;
        resolved.set(key, id);
      }
    }

    const missing = usernames.filter((username) => !resolved.has(String(username).trim().toLowerCase()));
    return { resolved, missing };
  } catch {
    return { resolved: new Map(), missing: usernames };
  } finally {
    clearAbortTimeout(timeout);
  }
}

function buildAssetPermissionUrl(assetId) {
  if (ROBLOX_ASSET_PERMISSIONS_URL_TEMPLATE) {
    return ROBLOX_ASSET_PERMISSIONS_URL_TEMPLATE.replaceAll("{assetId}", encodeURIComponent(assetId));
  }
  return `${ROBLOX_ASSETS_API_BASE_URL}/assets/${encodeURIComponent(assetId)}/permissions`;
}

async function updateAssetPermissions({ assetId, userIds }) {
  const robloxApiKey = getRobloxApiKey();
  const permissionUrl = buildAssetPermissionUrl(assetId);
  const candidateBodies = [
    {
      requests: userIds.map((userId) => ({
        subjectType: "User",
        subjectId: String(userId),
        action: "Use",
      })),
    },
    {
      requests: userIds.map((userId) => ({
        subjectType: "USER",
        subjectId: String(userId),
        action: "Use",
      })),
    },
    {
      requests: userIds.map((userId) => ({
        subjectType: "User",
        subjectId: String(userId),
        action: "use",
      })),
    },
    {
      permissions: userIds.map((userId) => ({
        subjectType: "User",
        subjectId: String(userId),
        action: "Use",
      })),
    },
    {
      requests: userIds.map((userId) => ({
        subject: {
          type: "User",
          id: String(userId),
        },
        action: "Use",
      })),
    },
  ];
  const methods = ["PATCH", "POST"];
  let lastFailure = { ok: false, status: 500, message: "Gagal set permission asset.", payload: null };

  for (const method of methods) {
    for (const body of candidateBodies) {
      const { signal, timeout } = createAbortSignal(REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(permissionUrl, {
          method,
          headers: {
            "x-api-key": robloxApiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });

        const payload = await parseResponseBody(response);
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            payload,
          };
        }

        lastFailure = {
          ok: false,
          status: response.status,
          message: payload?.message || `Roblox permission API error ${response.status}`,
          payload,
        };
      } catch (error) {
        lastFailure = {
          ok: false,
          status: 502,
          message: error instanceof Error ? error.message : "Network error saat set permission asset.",
          payload: null,
        };
      } finally {
        clearAbortTimeout(timeout);
      }
    }
  }

  return lastFailure;
}

async function applyCollaborationPermissions({ assetId, operationId, config }) {
  if (!config?.enabled || config.mode !== "connection") {
    return {
      enabled: false,
      mode: "none",
      grantedUserIds: [],
      unresolvedTargets: [],
      warnings: [],
      permissionApplied: false,
      message: "Kolaborasi tidak diaktifkan.",
    };
  }

  let activeAssetId = assetId ? String(assetId) : "";
  if (!activeAssetId && operationId) {
    activeAssetId = (await resolveAssetIdFromOperation(operationId)) || "";
  }

  if (!activeAssetId) {
    return {
      enabled: true,
      mode: config.mode,
      grantedUserIds: [],
      unresolvedTargets: config.rawTargets,
      warnings: config.warnings,
      permissionApplied: false,
      message: "Asset ID belum siap dari Roblox, permission kolaborasi belum bisa diterapkan.",
    };
  }

  if (!config.rawTargets.length) {
    return {
      enabled: true,
      mode: config.mode,
      grantedUserIds: [],
      unresolvedTargets: [],
      warnings: config.warnings,
      permissionApplied: false,
      message: "Kolaborasi aktif tapi daftar user kosong.",
    };
  }

  const directIds = [];
  const usernames = [];

  for (const token of config.rawTargets) {
    if (/^\d+$/.test(token)) {
      directIds.push(token);
    } else {
      usernames.push(token);
    }
  }

  const uniqueIds = new Set(directIds);
  const warnings = [...config.warnings];
  let unresolvedTargets = [];

  if (usernames.length) {
    const resolved = await resolveUserIdsFromUsernames(usernames);
    for (const userId of resolved.resolved.values()) {
      uniqueIds.add(userId);
    }
    unresolvedTargets = resolved.missing;
    if (resolved.missing.length) {
      warnings.push(`Username tidak ditemukan: ${resolved.missing.join(", ")}`);
    }
  }

  const finalUserIds = Array.from(uniqueIds);
  if (!finalUserIds.length) {
    return {
      enabled: true,
      mode: config.mode,
      grantedUserIds: [],
      unresolvedTargets,
      warnings,
      permissionApplied: false,
      message: "Tidak ada user valid untuk kolaborasi.",
    };
  }

  let permissionResult = await updateAssetPermissions({ assetId: activeAssetId, userIds: finalUserIds });

  if (
    !permissionResult.ok &&
    permissionResult.status === 404 &&
    COLLAB_PERMISSION_RETRY_ON_404 &&
    COLLAB_PERMISSION_RETRY_ATTEMPTS > 1
  ) {
    const maxAttempts = Math.max(1, Math.floor(COLLAB_PERMISSION_RETRY_ATTEMPTS));
    const retryIntervalMs = Math.max(250, Math.floor(COLLAB_PERMISSION_RETRY_INTERVAL_MS));

    for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
      await delay(retryIntervalMs);
      permissionResult = await updateAssetPermissions({ assetId: activeAssetId, userIds: finalUserIds });
      if (permissionResult.ok || permissionResult.status !== 404) {
        break;
      }
    }

    if (!permissionResult.ok && permissionResult.status === 404) {
      permissionResult = {
        ...permissionResult,
        message:
          "Roblox permission API masih 404 setelah retry. Biasanya asset baru belum propagate. Tunggu 15-60 detik lalu coba lagi.",
      };
    }
  }

  return {
    enabled: true,
    mode: config.mode,
    grantedUserIds: permissionResult.ok ? finalUserIds : [],
    unresolvedTargets,
    warnings,
    permissionApplied: permissionResult.ok,
    message: permissionResult.ok ? "Permission kolaborasi berhasil disetel." : permissionResult.message,
    status: permissionResult.status,
  };
}

function inferClientErrorStatus(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/melebihi batas/i.test(message)) return 400;
  if (/durasi audio/i.test(message)) return 400;
  if (/tidak bisa dibaca/i.test(message)) return 400;
  return 500;
}

function normalizeTargetProfile(value) {
  const fallback = "whis-tone-match";
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return SUPPORTED_TONE_PROFILES.has(normalized) ? normalized : fallback;
}

function buildToneFilter(profileName, settings) {
  if (profileName === "whis-tone-match") {
    const shiftedRate = Math.max(1000, Math.round(PROCESS_SAMPLE_RATE * settings.changeSpeedValue));
    return [
      `aresample=${PROCESS_SAMPLE_RATE}`,
      `asetrate=${shiftedRate}`,
      `aresample=${PROCESS_SAMPLE_RATE}`,
      `volume=${settings.ampDb}dB`,
    ].join(",");
  }

  throw new Error(`Profil modif tidak didukung: ${profileName}`);
}

function buildProcessedFileName(sourceFileName, extension) {
  const baseName = path.basename(sourceFileName || "audio-upload", path.extname(sourceFileName || ""));
  const cleaned = baseName
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${cleaned || "audio-upload"}-tone-match${extension}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_BINARY) {
      reject(new Error("FFmpeg tidak ditemukan. Install dependency ffmpeg-static atau isi FFMPEG_PATH."));
      return;
    }

    const child = spawn(FFMPEG_BINARY, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 5000) {
        stderr += String(chunk);
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Gagal menjalankan FFmpeg: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg gagal dengan exit code ${code}: ${stderr || "tanpa detail"}`));
    });
  });
}

async function applyToneMatchProfile({ buffer, fileName, targetProfile, settings }) {
  const profileName = normalizeTargetProfile(targetProfile);
  const activeSettings = settings || buildAudioProcessSettings({});
  const filter = buildToneFilter(profileName, activeSettings);
  const sourceExt = path.extname(fileName || "").toLowerCase();
  const inputExt = AUDIO_EXTENSIONS.has(sourceExt) ? sourceExt : ".mp3";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bypas-musik-"));
  const inputPath = path.join(tempDir, `source${inputExt}`);
  const outputPath = path.join(tempDir, "processed.ogg");

  await fs.writeFile(inputPath, buffer);

  try {
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-af",
      filter,
      "-c:a",
      "libvorbis",
      "-q:a",
      String(activeSettings.exportOggQuality),
      "-ar",
      String(PROCESS_SAMPLE_RATE),
      "-ac",
      "2",
      outputPath,
    ]);

    const processedBuffer = await fs.readFile(outputPath);
    if (!processedBuffer.length) {
      throw new Error("FFmpeg selesai tapi output audio kosong.");
    }

    return {
      buffer: processedBuffer,
      fileName: buildProcessedFileName(fileName, ".ogg"),
      contentType: "audio/ogg",
      appliedProfile: profileName,
      appliedSettings: activeSettings,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function extractOperationPath(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.path === "string") return payload.path;
  if (typeof payload.name === "string" && payload.name.includes("operations/")) return payload.name;
  if (typeof payload.operationPath === "string") return payload.operationPath;
  return null;
}

function extractAssetId(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.assetId) return String(payload.assetId);
  if (payload.targetId) return String(payload.targetId);
  if (payload.id && /^\d+$/.test(String(payload.id))) return String(payload.id);

  if (payload.response && typeof payload.response === "object") {
    if (payload.response.assetId) return String(payload.response.assetId);
    if (payload.response.targetId) return String(payload.response.targetId);
    if (payload.response.id && /^\d+$/.test(String(payload.response.id))) return String(payload.response.id);
  }

  if (payload.result && typeof payload.result === "object") {
    if (payload.result.assetId) return String(payload.result.assetId);
    if (payload.result.targetId) return String(payload.result.targetId);
    if (payload.result.id && /^\d+$/.test(String(payload.result.id))) return String(payload.result.id);
  }

  return null;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

function toOperationUrl(operationPath) {
  if (!operationPath) return null;
  if (/^https?:\/\//i.test(operationPath)) return operationPath;

  const cleaned = operationPath.replace(/^\/+/, "");
  if (cleaned.startsWith("assets/v1/")) {
    return `https://apis.roblox.com/${cleaned}`;
  }

  if (cleaned.startsWith("operations/")) {
    return `${ROBLOX_ASSETS_API_BASE_URL}/${cleaned}`;
  }

  return `${ROBLOX_ASSETS_API_BASE_URL}/operations/${cleaned}`;
}

async function pollOperation(operationPath, robloxApiKey, maxAttempts = 30, intervalMs = 2000) {
  const operationUrl = toOperationUrl(operationPath);
  if (!operationUrl) return null;

  for (let i = 0; i < maxAttempts; i += 1) {
    const { signal, timeout } = createAbortSignal(20000);

    try {
      const response = await fetch(operationUrl, {
        method: "GET",
        headers: {
          "x-api-key": robloxApiKey,
          Accept: "application/json",
        },
        signal,
      });

      if (response.ok) {
        const payload = await parseResponseBody(response);
        const assetId = extractAssetId(payload);
        const done = Boolean(payload && typeof payload === "object" && payload.done === true);

        if (assetId || done) return payload;
      }
    } catch {
      // transient network error, keep polling
    } finally {
      clearAbortTimeout(timeout);
    }

    await delay(intervalMs);
  }

  return null;
}

async function resolveAssetIdFromOperation(operationPath, maxAttempts = 35) {
  if (!operationPath) return null;

  let robloxApiKey;
  try {
    robloxApiKey = getRobloxApiKey();
  } catch {
    return null;
  }

  const operationUrl = toOperationUrl(operationPath);
  if (!operationUrl) return null;

  for (let i = 0; i < maxAttempts; i += 1) {
    const { signal, timeout } = createAbortSignal(20000);

    try {
      const response = await fetch(operationUrl, {
        method: "GET",
        headers: {
          "x-api-key": robloxApiKey,
          Accept: "application/json",
        },
        signal,
      });

      if (response.ok) {
        const payload = await parseResponseBody(response);
        const assetId = extractAssetId(payload);
        if (assetId) return assetId;

        const done = Boolean(payload && typeof payload === "object" && payload.done === true);
        if (done && !assetId) {
          if (payload?.error) {
            console.error("Roblox operation returned error:", payload.error);
          }
          return null;
        }
      }
    } catch {
      // transient network error, keep polling
    } finally {
      clearAbortTimeout(timeout);
    }

    await delay(Math.max(POLL_INTERVAL_MS, 1500));
  }

  return null;
}

async function uploadToRoblox({ buffer, fileName, contentType, displayName, description, assetType = "Audio" }) {
  const robloxApiKey = getRobloxApiKey();
  const creationContext = await getCreationContext();

  const requestPayload = {
    assetType,
    displayName,
    description,
    creationContext,
  };

  const formData = new FormData();
  formData.append("request", JSON.stringify(requestPayload));

  const fileBlob = new Blob([buffer], { type: contentType || "application/octet-stream" });
  formData.append("fileContent", fileBlob, fileName || "audio-upload.mp3");

  const timeoutMs = Math.max(REQUEST_TIMEOUT_MS, 180000);
  const { signal, timeout } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(`${ROBLOX_ASSETS_API_BASE_URL}/assets`, {
      method: "POST",
      headers: {
        "x-api-key": robloxApiKey,
        Accept: "application/json",
      },
      body: formData,
      signal,
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const message = payload && payload.message ? payload.message : `Roblox API error ${response.status}`;
      return {
        ok: false,
        status: response.status,
        message,
        payload,
      };
    }

    const operationPath = extractOperationPath(payload);
    let operationData = null;
    let assetId = extractAssetId(payload);

    if (operationPath && !assetId && POLL_ENABLED) {
      operationData = await pollOperation(operationPath, robloxApiKey, POLL_ATTEMPTS, POLL_INTERVAL_MS);
      assetId = extractAssetId(operationData);
    }

    return {
      ok: true,
      operationId: operationPath,
      assetId: assetId || null,
      payload,
      operationData,
    };
  } finally {
    clearAbortTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Auth sederhana:
// - User: login cukup pakai username (tanpa password), bisa upload audio.
// - Admin: login pakai ADMIN_CODE, bisa memantau semua upload user + atur API key.
// ---------------------------------------------------------------------------
const authSessions = new Map();
const authUsers = new Map();
let authStoreLoadAttempted = false;
let authStoreWriteQueue = Promise.resolve();

function normalizeUsernameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsernameInput(value) {
  const username = String(value || "").trim().replace(/\s+/g, " ");
  if (!username) return { ok: false, message: "Username wajib diisi." };
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, message: "Username 2-32 karakter, boleh huruf, angka, spasi, titik, underscore, atau dash." };
  }
  return { ok: true, username };
}

function safeCodeCompare(input, expected) {
  const rawInput = Buffer.from(String(input || ""), "utf8");
  const rawExpected = Buffer.from(String(expected || ""), "utf8");
  if (rawInput.length !== rawExpected.length) return false;
  return timingSafeEqual(rawInput, rawExpected);
}

async function writeJsonFile(filePath, data) {
  await writeDataFile(filePath, JSON.stringify(data, null, 2));
}

// Tulis file data + pastikan folder induknya ada (penting kalau path diarahkan ke Volume /data)
async function writeDataFile(filePath, contents) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } catch {
    // kalau folder belum bisa dibuat, biarkan writeFile yang melaporkan error
  }
  await fs.writeFile(filePath, contents, "utf8");
}

async function loadAuthStore() {
  if (authStoreLoadAttempted) return;
  authStoreLoadAttempted = true;

  try {
    const rawSessions = await fs.readFile(AUTH_SESSIONS_FILE, "utf8");
    const parsed = JSON.parse(rawSessions);
    const list = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    for (const session of list) {
      if (!session?.token) continue;
      if (Number(session.expiresAtMs) && session.expiresAtMs < Date.now()) continue;
      authSessions.set(session.token, session);
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      console.warn("Gagal membaca file sesi login:", error instanceof Error ? error.message : error);
    }
  }

  try {
    const rawUsers = await fs.readFile(AUTH_USERS_FILE, "utf8");
    const parsed = JSON.parse(rawUsers);
    const list = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    for (const user of list) {
      const key = normalizeUsernameKey(user?.usernameKey || user?.username);
      if (!key) continue;
      authUsers.set(key, {
        username: user.username || key,
        usernameKey: key,
        firstSeenAt: user.firstSeenAt || null,
        lastSeenAt: user.lastSeenAt || null,
        lastLoginAt: user.lastLoginAt || null,
        loginCount: Number(user.loginCount || 0),
        uploadCount: Number(user.uploadCount || 0),
      });
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      console.warn("Gagal membaca file daftar user:", error instanceof Error ? error.message : error);
    }
  }
}

function persistAuthStore() {
  const run = async () => {
    const sessions = Array.from(authSessions.values()).filter((session) => !session.expiresAtMs || session.expiresAtMs > Date.now());
    const users = Array.from(authUsers.values()).sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
    await writeJsonFile(AUTH_SESSIONS_FILE, sessions);
    await writeJsonFile(AUTH_USERS_FILE, users);
  };

  const queued = authStoreWriteQueue.then(run, run);
  authStoreWriteQueue = queued.catch(() => {});
  return queued;
}

function issueAuthSession({ role, username }) {
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  const session = {
    token,
    role,
    username: username || null,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAtMs: now + AUTH_SESSION_TTL_MS,
  };
  authSessions.set(token, session);
  persistAuthStore().catch(() => {});
  return session;
}

function registerAuthUser(username, { role = "user" } = {}) {
  const key = normalizeUsernameKey(username);
  if (!key) return null;

  const nowIso = new Date().toISOString();
  const previous = authUsers.get(key);
  const record = {
    username: previous?.username || username,
    usernameKey: key,
    firstSeenAt: previous?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    lastLoginAt: nowIso,
    loginCount: Number(previous?.loginCount || 0) + 1,
    uploadCount: Number(previous?.uploadCount || 0),
    lastRole: role,
  };
  authUsers.set(key, record);
  persistAuthStore().catch(() => {});
  return record;
}

function countUserUploads(username, amount = 1) {
  const key = normalizeUsernameKey(username);
  if (!key) return;

  const previous = authUsers.get(key) || {
    username,
    usernameKey: key,
    firstSeenAt: null,
    lastSeenAt: null,
    lastLoginAt: null,
    loginCount: 0,
    uploadCount: 0,
  };

  authUsers.set(key, {
    ...previous,
    uploadCount: Number(previous.uploadCount || 0) + amount,
    lastSeenAt: new Date().toISOString(),
  });
  persistAuthStore().catch(() => {});
}

async function readSessionFromRequest(req) {
  await loadAuthStore();

  const authHeader = String(req.headers.authorization || "").trim();
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const token = bearerToken || String(req.headers["x-auth-token"] || "").trim();
  if (!token) return null;

  const session = authSessions.get(token);
  if (!session) return null;

  if (session.expiresAtMs && session.expiresAtMs < Date.now()) {
    authSessions.delete(token);
    persistAuthStore().catch(() => {});
    return null;
  }

  return session;
}

async function requireAuthSession(req, res, next) {
  const session = await readSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ ok: false, message: "Login dulu untuk memakai fitur ini." });
  }
  req.auth = session;
  return next();
}

function requireAuthRole(role) {
  return (req, res, next) => {
    if (!req.auth || req.auth.role !== role) {
      return res.status(403).json({ ok: false, message: "Aksi ini khusus admin." });
    }
    return next();
  };
}

function requireAdminAccess(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") {
    return res.status(403).json({ ok: false, message: "Aksi ini khusus admin." });
  }
  return next();
}

// ---------------------------------------------------------------------------
// Pengaturan Studio (suffix nama, uppercase, playback speed, folder).
// Hanya admin yang boleh mengubah, user cuma membaca dipakai untuk script.
// ---------------------------------------------------------------------------
let studioSettingsCache = null;
let studioSettingsWriteQueue = Promise.resolve();

function normalizeStudioSettings(payload, current = DEFAULT_STUDIO_SETTINGS) {
  const rawSpeed = String(payload?.studioPlaybackSpeed ?? payload?.playbackSpeed ?? "").trim();
  const parsedSpeed = Number(rawSpeed);
  const speed = Number.isFinite(parsedSpeed) && parsedSpeed > 0 && parsedSpeed <= 10
    ? String(parsedSpeed)
    : current.studioPlaybackSpeed;

  const rawService = String(payload?.studioTargetService ?? "").trim();
  const targetService = STUDIO_TARGET_SERVICES.has(rawService) ? rawService : current.studioTargetService;

  const rawFolder = String(payload?.studioFolderName ?? "").trim().replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 32);
  const folderName = rawFolder || current.studioFolderName;

  const suffixProvided = payload?.nameSuffix !== undefined || payload?.customSuffix !== undefined;
  const nameSuffix = suffixProvided
    ? String(payload?.nameSuffix ?? payload?.customSuffix ?? "").trim().slice(0, 24)
    : current.nameSuffix;

  const autoUppercase = payload?.autoUppercase === undefined
    ? current.autoUppercase
    : parseBooleanFlag(payload.autoUppercase, true);

  const rawRound = String(payload?.roundLabel ?? "").trim().slice(0, 40);

  const rawMode = String(payload?.processingMode ?? "").trim().toLowerCase();
  const processingMode = rawMode === "ori" || rawMode === "custom" ? rawMode : current.processingMode;

  const changeSpeedValue = parseNumberInRange(
    payload?.changeSpeedValue,
    Number(current.changeSpeedValue),
    MIN_SPEED_MULTIPLIER,
    MAX_SPEED_MULTIPLIER
  );
  const exportOggQuality = Math.round(
    parseNumberInRange(
      payload?.exportOggQuality,
      Number(current.exportOggQuality),
      MIN_EXPORT_OGG_QUALITY,
      MAX_EXPORT_OGG_QUALITY
    )
  );
  const ampDb = parseNumberInRange(payload?.ampDb, Number(current.ampDb), MIN_AMP_DB, MAX_AMP_DB);

  return {
    studioPlaybackSpeed: speed,
    studioTargetService: targetService,
    studioFolderName: folderName,
    nameSuffix,
    autoUppercase,
    roundLabel: rawRound,
    processingMode,
    changeSpeedValue,
    exportOggQuality,
    ampDb,
  };
}

async function readStudioSettings() {
  if (studioSettingsCache) return studioSettingsCache;
  try {
    const raw = await fs.readFile(STUDIO_SETTINGS_FILE, "utf8");
    studioSettingsCache = normalizeStudioSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.warn("Gagal membaca pengaturan studio:", error instanceof Error ? error.message : error);
    }
    studioSettingsCache = { ...DEFAULT_STUDIO_SETTINGS };
  }
  return studioSettingsCache;
}

async function saveStudioSettings(payload) {
  const settings = normalizeStudioSettings(payload, studioSettingsCache || DEFAULT_STUDIO_SETTINGS);
  studioSettingsCache = settings;

  const run = () => writeDataFile(STUDIO_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  const queued = studioSettingsWriteQueue.then(run, run);
  studioSettingsWriteQueue = queued.catch(() => {});
  await queued;
  return settings;
}

// ---------------------------------------------------------------------------
// Cookies YouTube: bisa diisi admin dari dashboard (tanpa upload file ke Git).
// ---------------------------------------------------------------------------
const COOKIES_STORE_FILE = YTDL_COOKIES_FILE || DEFAULT_COOKIES_FILE_PATH;

function parseCookiesPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.cookies)) return raw.cookies;
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.cookies)) return parsed.cookies;
    return null;
  } catch {
    return null;
  }
}

function sanitizeCookiesList(list) {
  if (!Array.isArray(list) || !list.length) return null;

  const cleaned = list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const cookie = { ...item };
      cookie.name = String(item.name || "").trim();
      cookie.value = String(item.value ?? "").trim();
      cookie.domain = String(item.domain || ".youtube.com").trim();
      cookie.path = String(item.path || "/").trim();
      cookie.secure = item.secure !== false;
      cookie.httpOnly = Boolean(item.httpOnly);
      if (!cookie.sameSite) cookie.sameSite = "Lax";
      return cookie;
    })
    .filter((item) => item.name && item.value);

  return cleaned.length ? cleaned : null;
}

async function readSavedYouTubeCookies() {
  try {
    const raw = await fs.readFile(COOKIES_STORE_FILE, "utf8");
    return sanitizeCookiesList(parseCookiesPayload(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function resetYouTubeCookieCache() {
  YTDL_AGENT = null;
  YTDL_COOKIES = null;
  ytdlAgentLoadAttempted = false;
}

app.post("/api/auth/user-login", async (req, res) => {
  await loadAuthStore();
  const check = validateUsernameInput(req.body?.username);
  if (!check.ok) {
    return res.status(400).json({ ok: false, message: check.message });
  }

  const user = registerAuthUser(check.username, { role: "user" });
  const session = issueAuthSession({ role: "user", username: check.username });

  return res.json({
    ok: true,
    message: `Halo ${check.username}, siap upload lagu.`,
    session: {
      token: session.token,
      role: session.role,
      username: session.username,
      createdAt: session.createdAt,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    },
    user,
  });
});

app.post("/api/auth/admin-login", async (req, res) => {
  await loadAuthStore();
  const code = String(req.body?.code || "").trim();
  if (!code) {
    return res.status(400).json({ ok: false, message: "Kode admin wajib diisi." });
  }

  if (!safeCodeCompare(code, ADMIN_LOGIN_CODE)) {
    return res.status(401).json({ ok: false, message: "Kode admin salah." });
  }

  const session = issueAuthSession({ role: "admin", username: "admin" });
  return res.json({
    ok: true,
    message: "Login admin berhasil.",
    session: {
      token: session.token,
      role: session.role,
      username: session.username,
      createdAt: session.createdAt,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    },
  });
});

app.get("/api/auth/me", requireAuthSession, async (req, res) => {
  return res.json({
    ok: true,
    session: {
      role: req.auth.role,
      username: req.auth.username,
      createdAt: req.auth.createdAt,
      expiresAt: new Date(req.auth.expiresAtMs).toISOString(),
    },
  });
});

app.post("/api/auth/logout", requireAuthSession, async (req, res) => {
  const authHeader = String(req.headers.authorization || "").trim();
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const token = bearerToken || String(req.headers["x-auth-token"] || "").trim();
  if (token) authSessions.delete(token);
  await persistAuthStore().catch(() => {});
  return res.json({ ok: true, message: "Logout berhasil." });
});

app.get("/api/admin/overview", requireAuthSession, requireAdminAccess, async (_req, res) => {
  try {
    await loadAuthStore();
    const history = await readUploadHistory();
    const todayKey = getLocalDateKey(new Date());
    const perUser = new Map();

    for (const item of history) {
      const rawName = String(item?.username || "").trim();
      const key = normalizeUsernameKey(rawName) || "tanpa-user";
      const entry = perUser.get(key) || {
        username: rawName || "(tanpa user)",
        usernameKey: key,
        totalUploads: 0,
        todayUploads: 0,
        withAssetId: 0,
        lastUploadAt: null,
        lastUploadName: null,
        dates: new Set(),
      };

      entry.totalUploads += 1;
      if (item?.uploadDate === todayKey) entry.todayUploads += 1;
      if (item?.assetId) entry.withAssetId += 1;
      if (item?.uploadDate) entry.dates.add(item.uploadDate);
      if (!entry.lastUploadAt || String(item?.uploadedAt || "") > String(entry.lastUploadAt)) {
        entry.lastUploadAt = item?.uploadedAt || null;
        entry.lastUploadName = item?.uploadedName || item?.sourceName || null;
      }
      perUser.set(key, entry);
    }

    for (const [key, user] of authUsers.entries()) {
      if (!perUser.has(key)) {
        perUser.set(key, {
          username: user.username,
          usernameKey: key,
          totalUploads: 0,
          todayUploads: 0,
          withAssetId: 0,
          lastUploadAt: null,
          lastUploadName: null,
          dates: new Set(),
        });
      }
      const entry = perUser.get(key);
      entry.firstSeenAt = user.firstSeenAt || null;
      entry.lastLoginAt = user.lastLoginAt || null;
      entry.loginCount = Number(user.loginCount || 0);
    }

    const users = Array.from(perUser.values())
      .map((entry) => ({
        username: entry.username,
        usernameKey: entry.usernameKey,
        totalUploads: entry.totalUploads,
        todayUploads: entry.todayUploads,
        withAssetId: entry.withAssetId,
        activeDays: entry.dates.size,
        lastUploadAt: entry.lastUploadAt,
        lastUploadName: entry.lastUploadName,
        firstSeenAt: entry.firstSeenAt || null,
        lastLoginAt: entry.lastLoginAt || null,
        loginCount: entry.loginCount || 0,
      }))
      .sort((a, b) => b.totalUploads - a.totalUploads || String(b.lastUploadAt || "").localeCompare(String(a.lastUploadAt || "")));

    const dailyMap = new Map();
    for (const item of history) {
      const dateKey = String(item?.uploadDate || "").trim();
      if (!dateKey) continue;
      dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + 1);
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 14);

    return res.json({
      ok: true,
      totals: {
        historyRecords: history.length,
        users: users.length,
        activeUsers: users.filter((user) => user.totalUploads > 0).length,
        todayUploads: history.filter((item) => item?.uploadDate === todayKey).length,
        todayDate: todayKey,
        activeSessions: Array.from(authSessions.values()).filter((session) => session.role === "user").length,
      },
      users,
      daily,
      recent: history.slice(-30).reverse(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal membuat ringkasan admin.",
    });
  }
});

app.get("/api/admin/users", requireAuthSession, requireAdminAccess, async (_req, res) => {
  await loadAuthStore();
  return res.json({
    ok: true,
    users: Array.from(authUsers.values()).sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""))),
  });
});

app.get("/api/roblox/health", async (_req, res) => {
  const studioSettings = await readStudioSettings();
  const creatorUserId = String(process.env.ROBLOX_CREATOR_USER_ID || "").trim();
  const creatorGroupId = String(process.env.ROBLOX_CREATOR_GROUP_ID || "").trim();
  const activeApiKey = getActiveRobloxApiKey();
  const hasApiKey = Boolean(activeApiKey);
  const youtubeCookie = await getYouTubeCookieStatus();
  const envCreatorProfile = await fetchCreatorProfile({
    creatorUserId,
    creatorGroupId,
  });

  let creatorProfile = envCreatorProfile;
  let creatorResolvedBy = (creatorUserId || creatorGroupId) ? "env" : "none";
  let inferredCreator = null;

  if (!creatorProfile && hasApiKey) {
    try {
      inferredCreator = await resolveCreatorContextFromApiKey(activeApiKey);
      if (inferredCreator?.ok && inferredCreator?.creatorProfile) {
        creatorProfile = inferredCreator.creatorProfile;
        creatorResolvedBy = inferredCreator.source || "api-key";
      }
    } catch (error) {
      inferredCreator = {
        ok: false,
        message: error instanceof Error ? error.message : "Gagal introspect API key.",
      };
    }
  }

  res.json({
    ok: true,
    message: "Backend Roblox uploader aktif",
    hasApiKey,
    hasCreator: Boolean(creatorProfile),
    creatorUserId: creatorUserId || null,
    creatorGroupId: creatorGroupId || null,
    creatorProfile,
    creatorResolvedBy,
    inferredCreator,
    youtubeCookie,
    youtubeTool: await getYouTubeToolStatus(),
    maxAudioSeconds: MAX_AUDIO_SECONDS,
    maxAudioBytes: MAX_AUDIO_BYTES,
    toneProfileDefault: "whis-tone-match",
    audioProcessing: {
      defaultMode: studioSettings.processingMode,
      defaults: {
        changeSpeedValue: studioSettings.changeSpeedValue,
        exportOggQuality: studioSettings.exportOggQuality,
        ampDb: studioSettings.ampDb,
      },
      limits: {
        speed: { min: MIN_SPEED_MULTIPLIER, max: MAX_SPEED_MULTIPLIER },
        oggQuality: { min: MIN_EXPORT_OGG_QUALITY, max: MAX_EXPORT_OGG_QUALITY },
        ampDb: { min: MIN_AMP_DB, max: MAX_AMP_DB },
      },
    },
    collaboration: {
      modes: ["none", "connection"],
      maxCollaborators: MAX_COLLABORATORS,
      maxBatchFiles: MAX_BATCH_UPLOAD_FILES,
      uploadConcurrency: ROBLOX_UPLOAD_CONCURRENCY,
    },
  });
});

app.get("/api/roblox/settings/api-key", requireAuthSession, requireAdminAccess, async (_req, res) => {
  const envKey = String(process.env.ROBLOX_API_KEY || "").trim();
  const activeKey = getActiveRobloxApiKey();
  let inferredCreatorProfile = null;
  let inferredCreator = null;

  if (activeKey) {
    try {
      const inferred = await resolveCreatorContextFromApiKey(activeKey);
      inferredCreator = {
        ok: Boolean(inferred?.ok),
        message: inferred?.message || null,
        source: inferred?.source || null,
      };
      inferredCreatorProfile = inferred?.creatorProfile || null;
    } catch (error) {
      inferredCreator = {
        ok: false,
        message: error instanceof Error ? error.message : "Gagal introspect API key.",
        source: null,
      };
    }
  }

  return res.json({
    ok: true,
    hasApiKey: Boolean(activeKey),
    source: (dynamicRobloxApiKey || "").trim() ? "web-settings" : envKey ? "env" : "none",
    maskedKey: activeKey ? `${activeKey.slice(0, 4)}...${activeKey.slice(-4)}` : null,
    inferredCreator,
    creatorProfile: inferredCreatorProfile,
  });
});

app.post("/api/roblox/settings/api-key", requireAuthSession, requireAdminAccess, async (req, res) => {
  try {
    const newApiKey = String(req.body?.robloxApiKey || "").trim();
    if (!newApiKey) {
      return res.status(400).json({ ok: false, message: "robloxApiKey wajib diisi." });
    }

    const inferred = await resolveCreatorContextFromApiKey(newApiKey);
    if (!inferred?.ok) {
      return res.status(400).json({
        ok: false,
        message: inferred?.message || "API key valid, tapi creator tidak bisa ditentukan.",
      });
    }

    await saveDynamicRobloxApiKey(newApiKey);
    return res.json({
      ok: true,
      message: "API key Roblox berhasil disimpan.",
      inferredCreator: {
        source: inferred.source || "api-key",
        creatorProfile: inferred.creatorProfile || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal menyimpan API key Roblox.",
    });
  }
});

app.delete("/api/roblox/settings/api-key", requireAuthSession, requireAdminAccess, async (_req, res) => {
  try {
    await clearDynamicRobloxApiKey();
    return res.json({
      ok: true,
      message: "API key Roblox dari settings web berhasil dihapus.",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal menghapus API key Roblox.",
    });
  }
});

app.get("/api/roblox/settings/studio", requireAuthSession, async (_req, res) => {
  const settings = await readStudioSettings();
  return res.json({ ok: true, settings });
});

app.post("/api/roblox/settings/studio", requireAuthSession, requireAdminAccess, async (req, res) => {
  try {
    const settings = await saveStudioSettings(req.body || {});
    return res.json({
      ok: true,
      message: "Pengaturan studio & nama sound berhasil disimpan.",
      settings,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal menyimpan pengaturan studio.",
    });
  }
});

app.get("/api/roblox/settings/cookies", requireAuthSession, requireAdminAccess, async (_req, res) => {
  try {
    const status = await getYouTubeCookieStatus();
    const saved = await readSavedYouTubeCookies();
    return res.json({
      ok: true,
      status,
      savedCount: saved ? saved.length : 0,
      usesEnvJson: Boolean(YTDL_COOKIES_JSON),
      cookieFile: COOKIES_STORE_FILE,
      message: saved
        ? null
        : YTDL_COOKIES_JSON
          ? "Cookies dipakai dari Variables YTDL_COOKIES_JSON."
          : "Belum ada cookies yang disimpan.",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal membaca status cookies.",
    });
  }
});

app.post("/api/roblox/settings/cookies", requireAuthSession, requireAdminAccess, async (req, res) => {
  try {
    const parsed = parseCookiesPayload(req.body?.cookies ?? req.body?.json ?? req.body?.content);
    const cookies = sanitizeCookiesList(parsed);
    if (!cookies) {
      return res.status(400).json({
        ok: false,
        message: "Format cookies tidak valid. Tempel isi file cookies.json (array objek berisi name dan value).",
      });
    }

    await writeDataFile(COOKIES_STORE_FILE, JSON.stringify(cookies, null, 2));
    resetYouTubeCookieCache();
    const status = await getYouTubeCookieStatus();

    return res.json({
      ok: true,
      message: `Cookies YouTube (${cookies.length} item) berhasil disimpan.`,
      status,
      usesEnvJson: Boolean(YTDL_COOKIES_JSON),
      cookieFile: COOKIES_STORE_FILE,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal menyimpan cookies YouTube.",
    });
  }
});

app.post("/api/roblox/diagnose/youtube", requireAuthSession, requireAdminAccess, async (req, res) => {
  try {
    const target = String(req.body?.url || "https://www.youtube.com/watch?v=jNQXAC9IVRw").trim();
    if (!isYouTubeUrl(target)) {
      return res.status(400).json({ ok: false, message: "Diagnosis butuh link YouTube." });
    }

    const { watchUrl } = await resolveYouTubeWatchUrl(target);
    const probe = await probeYouTubeStrategies(watchUrl);
    return res.json({ ok: true, url: watchUrl, ...probe });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Diagnosis YouTube gagal.",
    });
  }
});

app.delete("/api/roblox/settings/cookies", requireAuthSession, requireAdminAccess, async (_req, res) => {
  try {
    await fs.rm(COOKIES_STORE_FILE, { force: true });
    resetYouTubeCookieCache();
    const status = await getYouTubeCookieStatus();
    return res.json({
      ok: true,
      message: "File cookies YouTube berhasil dihapus dari server.",
      status,
      usesEnvJson: Boolean(YTDL_COOKIES_JSON),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal menghapus cookies YouTube.",
    });
  }
});

app.get("/api/roblox/upload-history", requireAuthSession, async (req, res) => {
  try {
    const requestedDate = String(req.query.date || "").trim();
    if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return res.status(400).json({
        ok: false,
        message: "Format tanggal tidak valid. Gunakan YYYY-MM-DD.",
      });
    }

    // User biasa cuma boleh lihat riwayat miliknya sendiri, admin boleh lihat semua.
    const isPrivilegedAdmin = req.auth.role === "admin";
    const requestedUser = String(req.query.username || "").trim();
    const userFilter = isPrivilegedAdmin ? normalizeUsernameKey(requestedUser) : normalizeUsernameKey(req.auth.username);

    const limit = normalizeHistoryLimit(req.query.limit, 80);
    const history = await readUploadHistory();
    const filtered = history.filter((item) => {
      if (requestedDate && item?.uploadDate !== requestedDate) return false;
      if (!userFilter) return true;
      const itemUserKey = normalizeUsernameKey(item?.username);
      if (userFilter === HISTORY_NO_USER_KEY) return !itemUserKey;
      return itemUserKey === userFilter;
    });
    const items = filtered.slice(-limit).reverse();

    // Auto-resolve any missing assetIds in the background
    const missingAssetItems = items.filter((item) => !item.assetId && item.operationId);
    if (missingAssetItems.length > 0) {
      Promise.all(
        missingAssetItems.map(async (item) => {
          try {
            const assetId = await resolveAssetIdFromOperation(item.operationId, 5);
            if (assetId) {
              item.assetId = assetId;
              await updateUploadHistoryAssetId(item.uploadRecordId, assetId);
            }
          } catch {
            // ignore
          }
        })
      ).catch(() => {});
    }

    return res.json({
      ok: true,
      date: requestedDate || null,
      username: userFilter || null,
      role: req.auth.role,
      total: filtered.length,
      count: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal membaca riwayat upload.",
    });
  }
});

app.delete("/api/roblox/upload-history/:id", requireAuthSession, requireAdminAccess, async (req, res) => {
  try {
    const recordId = Number(req.params.id);
    if (!Number.isFinite(recordId)) {
      return res.status(400).json({ ok: false, message: "ID rekaman riwayat tidak valid." });
    }

    const deleted = await deleteUploadHistoryItem(recordId);
    if (!deleted) {
      return res.status(404).json({ ok: false, message: `Rekaman #${recordId} tidak ditemukan.` });
    }

    return res.json({
      ok: true,
      message: `Rekaman riwayat #${recordId} berhasil dihapus.`,
      deletedRecordId: recordId,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal menghapus rekaman riwayat.",
    });
  }
});

app.delete("/api/roblox/upload-history", requireAuthSession, requireAdminAccess, async (req, res) => {
  try {
    const requestedDate = String(req.query.date || "").trim();
    const requestedBatch = String(req.query.batch || req.query.batchId || req.query.batchLabel || "").trim();
    const requestedUser = String(req.query.username || "").trim();
    const clearAll = req.query.all === "true" || (!requestedDate && !requestedBatch && !requestedUser);

    const result = await clearUploadHistory({ date: requestedDate, batch: requestedBatch, username: requestedUser, all: clearAll });
    return res.json({
      ok: true,
      message: clearAll
        ? `Semua riwayat (${result.deletedCount} rekaman) berhasil dihapus.`
        : requestedBatch
          ? `Riwayat '${requestedBatch}' (${result.deletedCount} rekaman) berhasil dihapus.`
          : requestedUser
            ? `Riwayat user '${requestedUser}' (${result.deletedCount} rekaman) berhasil dihapus.`
            : `Riwayat tanggal ${requestedDate} (${result.deletedCount} rekaman) berhasil dihapus.`,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Gagal membersihkan riwayat.",
    });
  }
});

// Telegram HTTP endpoints removed

app.post(
  "/api/roblox/upload-file",
  requireAuthSession,
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 9999 },
  ]),
  async (req, res) => {
    try {
      const uploaderName = String(req.auth?.username || "").trim();
      const pickedFiles = [];
      if (Array.isArray(req.files?.files)) pickedFiles.push(...req.files.files);
      if (Array.isArray(req.files?.file)) pickedFiles.push(...req.files.file);

      if (!pickedFiles.length || !pickedFiles.some((file) => file && file.buffer)) {
        return res.status(400).json({ ok: false, message: "File audio belum ada." });
      }

      if (pickedFiles.length > MAX_BATCH_UPLOAD_FILES) {
        return res.status(400).json({
          ok: false,
          message: `Maksimal ${MAX_BATCH_UPLOAD_FILES} file per upload batch.`,
        });
      }

      const studioSettings = await readStudioSettings();
      const requestedToneMatch = parseBooleanFlag(req.body.applyToneMatch, false);
      const processingMode = resolveProcessingMode({
        requestedMode: req.body.processingMode || studioSettings.processingMode,
        applyToneMatch: requestedToneMatch || studioSettings.processingMode === "custom",
      });
      const audioSettings = buildAudioProcessSettings({
        changeSpeedValue: req.body.changeSpeedValue ?? studioSettings.changeSpeedValue,
        exportOggQuality: req.body.exportOggQuality ?? studioSettings.exportOggQuality,
        ampDb: req.body.ampDb ?? studioSettings.ampDb,
      });
      const collaborationConfig = parseCollaborationConfig(req.body);
      const nameSuffix =
        String(req.body.nameSuffix || req.body.customSuffix || "").trim() || studioSettings.nameSuffix;
      const autoUppercase =
        req.body.autoUppercase === undefined || req.body.autoUppercase === ""
          ? studioSettings.autoUppercase
          : parseBooleanFlag(req.body.autoUppercase, true);

      const uploadTasks = pickedFiles.map((currentFile, index) => async () => {
        if (!currentFile?.buffer) {
          return { ok: false, originalName: `file-${index + 1}`, uploadedName: `file-${index + 1}`, message: "File buffer kosong." };
        }

        const originalName = currentFile.originalname || `audio-upload-${index + 1}.mp3`;
        const ext = path.extname(originalName).toLowerCase();
        const requestedName = String(req.body.displayName || "").trim();
        const baseName = requestedName && pickedFiles.length > 1 ? `${requestedName} ${index + 1}` : requestedName || originalName;
        const displayName = normalizeAssetName(baseName, { uppercase: autoUppercase, suffix: nameSuffix });
        const description = normalizeDescription(req.body.description);
        const targetProfile = normalizeTargetProfile(req.body.targetProfile);

        if (ext && !AUDIO_EXTENSIONS.has(ext)) {
          return { ok: false, originalName, uploadedName: displayName, message: "Format file tidak didukung." };
        }

        try {
          await enforceRobloxAudioLimits({
            buffer: currentFile.buffer,
            fileName: originalName,
          });

          let uploadBuffer = currentFile.buffer;
          let uploadFileName = originalName;
          let contentType = getMimeType(originalName, currentFile.mimetype);
          let appliedProfile = null;
          let appliedSettings = null;

          if (processingMode === "custom") {
            const processed = await applyToneMatchProfile({
              buffer: currentFile.buffer,
              fileName: originalName,
              targetProfile,
              settings: audioSettings,
            });

            uploadBuffer = processed.buffer;
            uploadFileName = processed.fileName;
            contentType = processed.contentType;
            appliedProfile = processed.appliedProfile;
            appliedSettings = processed.appliedSettings;
          }

          const robloxResult = await uploadToRoblox({
            buffer: uploadBuffer,
            fileName: uploadFileName,
            contentType,
            displayName,
            description,
            assetType: req.body.assetType || "Audio",
          });

          if (!robloxResult.ok) {
            return {
              ok: false,
              originalName,
              uploadedName: displayName,
              message: robloxResult.message || "Gagal upload ke Roblox.",
              roblox: robloxResult.payload,
            };
          }

          let resolvedAssetId = robloxResult.assetId;
          if (!resolvedAssetId && robloxResult.operationId) {
            resolvedAssetId = await resolveAssetIdFromOperation(robloxResult.operationId);
          }

          const collaboration = await applyCollaborationPermissions({
            assetId: resolvedAssetId,
            operationId: robloxResult.operationId,
            config: collaborationConfig,
          });

          return {
            ok: true,
            originalName,
            uploadedName: displayName,
            uploadedDescription: description,
            operationId: robloxResult.operationId,
            assetId: resolvedAssetId,
            appliedProfile,
            processingMode,
            audioSettings: processingMode === "custom" ? appliedSettings : null,
            processingApplied: Boolean(appliedProfile),
            collaboration,
          };
        } catch (error) {
          return {
            ok: false,
            originalName,
            uploadedName: displayName,
            message: error instanceof Error ? error.message : "Internal server error",
          };
        }
      });

      const concurrencyResults = await runWithConcurrency(uploadTasks, ROBLOX_UPLOAD_CONCURRENCY);
      const uploadResults = concurrencyResults.map((item) => {
        if (item && item.__concurrencyError) {
          const error = item.error;
          return { ok: false, message: error instanceof Error ? error.message : "Concurrency error" };
        }
        return item;
      });


      const successUploads = uploadResults.filter((item) => item.ok);
      const failedUploads = uploadResults.filter((item) => !item.ok);

      const batchLabel = String(req.body.batchLabel || req.body.roundLabel || "").trim() || studioSettings.roundLabel;

      if (successUploads.length > 0) {
        const savedEntries = await appendUploadHistory(
          successUploads.map((item) => ({
            sourceType: "file",
            sourceName: item.originalName || item.uploadedName,
            uploadedName: item.uploadedName,
            assetId: item.assetId,
            operationId: item.operationId,
            username: uploaderName,
          })),
          { batchLabel, username: uploaderName }
        );
        attachSavedUploadMeta({ uploadResults, savedEntries });
        countUserUploads(uploaderName, successUploads.length);

        for (const item of uploadResults) {
          if (item && item.ok && !item.assetId && item.operationId && item.uploadRecordId) {
            scheduleBackgroundOperationResolver(item.operationId, item.uploadRecordId);
          }
        }
      }

      if (!successUploads.length) {
        return res.status(400).json({
          ok: false,
          message: "Semua upload file gagal diproses.",
          total: uploadResults.length,
          successCount: 0,
          failedCount: failedUploads.length,
          uploads: uploadResults,
        });
      }

      if (uploadResults.length === 1) {
        const item = uploadResults[0];
        return res.json({
          ok: true,
          message: "Upload request diterima Roblox.",
          uploadedName: item.uploadedName,
          uploadedDescription: item.uploadedDescription,
          operationId: item.operationId,
          assetId: item.assetId,
          uploadRecordId: item.uploadRecordId,
          uploadDate: item.uploadDate,
          uploadedAt: item.uploadedAt,
          appliedProfile: item.appliedProfile,
          processingMode: item.processingMode,
          audioSettings: item.audioSettings,
          processingApplied: item.processingApplied,
          collaboration: item.collaboration,
          uploads: uploadResults,
        });
      }

      return res.json({
        ok: true,
        message:
          failedUploads.length > 0
            ? `Batch selesai dengan ${successUploads.length} sukses dan ${failedUploads.length} gagal.`
            : `Batch upload sukses (${successUploads.length} file).`,
        total: uploadResults.length,
        successCount: successUploads.length,
        failedCount: failedUploads.length,
        uploads: uploadResults,
        collaborationMode: collaborationConfig.enabled ? collaborationConfig.mode : "none",
      });
    } catch (error) {
      return res.status(inferClientErrorStatus(error)).json({
        ok: false,
        message: error instanceof Error ? error.message : "Internal server error",
      });
    }
  }
);

app.post("/api/roblox/import-url", requireAuthSession, async (req, res) => {
  try {
    const uploaderName = String(req.auth?.username || "").trim();
    const studioSettings = await readStudioSettings();
    const importMode = String(req.body.importMode || "youtube-proxy");
    const requestedToneMatch = parseBooleanFlag(req.body.applyToneMatch, false);
    const processingMode = resolveProcessingMode({
      requestedMode: req.body.processingMode || studioSettings.processingMode,
      applyToneMatch: requestedToneMatch || studioSettings.processingMode === "custom",
    });
    const audioSettings = buildAudioProcessSettings({
      changeSpeedValue: req.body.changeSpeedValue ?? studioSettings.changeSpeedValue,
      exportOggQuality: req.body.exportOggQuality ?? studioSettings.exportOggQuality,
      ampDb: req.body.ampDb ?? studioSettings.ampDb,
    });
    const targetProfile = normalizeTargetProfile(req.body.targetProfile);
    const collaborationConfig = parseCollaborationConfig(req.body);
    const rawUrls = parseImportUrlTargets(req.body);
    if (!rawUrls.length) {
      return res.status(400).json({ ok: false, message: "URL wajib diisi." });
    }

    const description = normalizeDescription(req.body.description);
    const requestedDisplayName = String(req.body.displayName || "").trim();
    const nameSuffix =
      String(req.body.nameSuffix || req.body.customSuffix || "").trim() || studioSettings.nameSuffix;
    const autoUppercase =
      req.body.autoUppercase === undefined || req.body.autoUppercase === ""
        ? studioSettings.autoUppercase
        : parseBooleanFlag(req.body.autoUppercase, true);

    const uploadTasks = rawUrls.map((rawUrl, index) => async () => {
      let parsedUrl;

      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        return { ok: false, sourceUrl: rawUrl, message: "URL tidak valid." };
      }

      if (importMode === "direct-audio-url" && !isAudioLikeUrl(rawUrl)) {
        return { ok: false, sourceUrl: rawUrl, message: "Mode direct-audio-url butuh link langsung ke file audio (.mp3/.wav/.ogg/.flac)." };
      }

      if (importMode === "youtube-proxy" && !isYouTubeUrl(rawUrl)) {
        return { ok: false, sourceUrl: rawUrl, message: "Mode youtube-proxy butuh URL YouTube yang valid." };
      }

      try {
        let originalAudioBuffer;
        let sourceName;
        let sourceType;

        if (importMode === "youtube-proxy") {
          const downloaded = await downloadYouTubeAudio(rawUrl);
          originalAudioBuffer = downloaded.buffer;
          sourceName = downloaded.fileName;
          sourceType = downloaded.contentType;

          await enforceRobloxAudioLimits({
            buffer: originalAudioBuffer,
            fileName: sourceName,
          });
        } else {
          const { signal, timeout } = createAbortSignal(REQUEST_TIMEOUT_MS);
          let sourceResponse;

          try {
            sourceResponse = await fetch(parsedUrl.toString(), {
              method: "GET",
              signal,
            });
          } finally {
            clearAbortTimeout(timeout);
          }

          if (!sourceResponse.ok) {
            return { ok: false, sourceUrl: rawUrl, message: `Gagal mengambil file dari URL sumber (${sourceResponse.status}).` };
          }

          sourceType = String(sourceResponse.headers.get("content-type") || "").toLowerCase();
          sourceName = getFileNameFromUrl(parsedUrl.toString());

          if (!sourceType.startsWith("audio/") && !AUDIO_EXTENSIONS.has(path.extname(sourceName).toLowerCase())) {
            return { ok: false, sourceUrl: rawUrl, message: "URL tidak mengarah ke file audio langsung. Pakai mode youtube-proxy untuk URL YouTube." };
          }

          originalAudioBuffer = Buffer.from(await sourceResponse.arrayBuffer());
          await enforceRobloxAudioLimits({
            buffer: originalAudioBuffer,
            fileName: sourceName,
          });
        }

        const baseDisplayName = importMode === "youtube-proxy" ? sourceName : requestedDisplayName || sourceName;
        const targetName = requestedDisplayName && rawUrls.length > 1 && importMode !== "youtube-proxy"
          ? `${requestedDisplayName} ${index + 1}`
          : baseDisplayName;
        const displayName = normalizeAssetName(targetName, { uppercase: autoUppercase, suffix: nameSuffix });

        let uploadBuffer = originalAudioBuffer;
        let uploadFileName = sourceName;
        let uploadContentType = getMimeType(sourceName, sourceType);
        let appliedProfile = null;
        let appliedSettings = null;

        if (processingMode === "custom") {
          const processed = await applyToneMatchProfile({
            buffer: originalAudioBuffer,
            fileName: sourceName,
            targetProfile,
            settings: audioSettings,
          });

          uploadBuffer = processed.buffer;
          uploadFileName = processed.fileName;
          uploadContentType = processed.contentType;
          appliedProfile = processed.appliedProfile;
          appliedSettings = processed.appliedSettings;
        }

        const robloxResult = await uploadToRoblox({
          buffer: uploadBuffer,
          fileName: uploadFileName,
          contentType: uploadContentType,
          displayName,
          description,
          assetType: req.body.assetType || "Audio",
        });

        if (!robloxResult.ok) {
          return {
            ok: false,
            sourceUrl: rawUrl,
            originalName: sourceName,
            uploadedName: displayName,
            message: robloxResult.message || "Gagal upload audio URL ke Roblox.",
            roblox: robloxResult.payload,
          };
        }

        let resolvedAssetId = robloxResult.assetId;
        if (!resolvedAssetId && robloxResult.operationId) {
          resolvedAssetId = await resolveAssetIdFromOperation(robloxResult.operationId);
        }

        const collaboration = await applyCollaborationPermissions({
          assetId: resolvedAssetId,
          operationId: robloxResult.operationId,
          config: collaborationConfig,
        });

        return {
          ok: true,
          sourceUrl: rawUrl,
          originalName: sourceName,
          uploadedName: displayName,
          uploadedDescription: description,
          operationId: robloxResult.operationId,
          assetId: resolvedAssetId,
          appliedProfile,
          processingMode,
          audioSettings: processingMode === "custom" ? appliedSettings : null,
          processingApplied: Boolean(appliedProfile),
          collaboration,
        };
      } catch (error) {
        return {
          ok: false,
          sourceUrl: rawUrl,
          message: error instanceof Error ? error.message : "Internal server error",
        };
      }
    });

    const concurrencyResults = await runWithConcurrency(uploadTasks, ROBLOX_UPLOAD_CONCURRENCY);
    const uploadResults = concurrencyResults.map((item) => {
      if (item && item.__concurrencyError) {
        const error = item.error;
        return { ok: false, message: error instanceof Error ? error.message : "Concurrency error" };
      }
      return item;
    });


    const successUploads = uploadResults.filter((item) => item.ok);
    const failedUploads = uploadResults.filter((item) => !item.ok);

    const batchLabel = String(req.body.batchLabel || req.body.roundLabel || "").trim() || studioSettings.roundLabel;

    if (successUploads.length > 0) {
      const savedEntries = await appendUploadHistory(
        successUploads.map((item) => ({
          sourceType: "url",
          sourceName: item.originalName || item.uploadedName,
          sourceUrl: item.sourceUrl,
          uploadedName: item.uploadedName,
          assetId: item.assetId,
          operationId: item.operationId,
          username: uploaderName,
        })),
        { batchLabel, username: uploaderName }
      );
      attachSavedUploadMeta({ uploadResults, savedEntries });
      countUserUploads(uploaderName, successUploads.length);

      for (const item of uploadResults) {
        if (item && item.ok && !item.assetId && item.operationId && item.uploadRecordId) {
          scheduleBackgroundOperationResolver(item.operationId, item.uploadRecordId);
        }
      }
    }

    if (!successUploads.length) {
      return res.status(400).json({
        ok: false,
        message: "Semua import URL gagal diproses.",
        total: uploadResults.length,
        successCount: 0,
        failedCount: failedUploads.length,
        uploads: uploadResults,
      });
    }

    if (uploadResults.length === 1) {
      const item = uploadResults[0];
      return res.json({
        ok: true,
        message:
          item.processingMode === "custom"
            ? "Audio dari URL berhasil diproses dan dikirim ke Roblox."
            : "Audio ori dari URL berhasil dikirim ke Roblox tanpa modifikasi.",
        uploadedName: item.uploadedName,
        uploadedDescription: item.uploadedDescription,
        operationId: item.operationId,
        assetId: item.assetId,
        uploadRecordId: item.uploadRecordId,
        uploadDate: item.uploadDate,
        uploadedAt: item.uploadedAt,
        appliedProfile: item.appliedProfile,
        processingMode: item.processingMode,
        audioSettings: item.audioSettings,
        processingApplied: item.processingApplied,
        collaboration: item.collaboration,
        uploads: uploadResults,
      });
    }

    return res.json({
      ok: true,
      message:
        failedUploads.length > 0
          ? `Batch URL selesai dengan ${successUploads.length} sukses dan ${failedUploads.length} gagal.`
          : `Batch import URL sukses (${successUploads.length} file).`,
      total: uploadResults.length,
      successCount: successUploads.length,
      failedCount: failedUploads.length,
      uploads: uploadResults,
      collaborationMode: collaborationConfig.enabled ? collaborationConfig.mode : "none",
    });
  } catch (error) {
    return res.status(inferClientErrorStatus(error)).json({
      ok: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// Semua endpoint API tidak dikenal -> JSON, bukan HTML index
app.use("/api", (_req, res) => {
  return res.status(404).json({ ok: false, message: "Endpoint API tidak ditemukan." });
});

// Sajikan hasil build frontend (npm run build) dari folder dist, jadi satu service
// di Railway sudah cukup untuk web + API dengan base URL otomatis "/api/roblox".
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api).*/, (_req, res) => {
    return res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      ok: false,
      message: `Ukuran file terlalu besar. Batas maksimal ${Math.floor(MAX_AUDIO_BYTES / (1024 * 1024))} MB.`,
    });
  }

  return res.status(500).json({
    ok: false,
    message: error instanceof Error ? error.message : "Internal server error",
  });
});

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Roblox API backend jalan di http://localhost:${PORT}`);
  if (!process.env.ADMIN_CODE) {
    console.warn("ADMIN_CODE belum di-set di .env, memakai kode default. Ganti sebelum dipakai publik.");
  }
  if (!existsSync(DIST_DIR)) {
    console.log("Folder dist belum ada, jalankan `npm run build` kalau mau web dan API dilayani satu server.");
  }
});
