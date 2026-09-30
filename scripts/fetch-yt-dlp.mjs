#!/usr/bin/env node
/*
  Unduh binary yt-dlp standalone (tidak butuh Python) ke folder bin/.
  Dijalankan otomatis lewat "postinstall" di package.json, jadi ikut saat Railway build.
  Tidak pernah bikin npm install gagal: kalau unduhan bermasalah cuma dikasih warning.

  Cara manual:
    node scripts/fetch-yt-dlp.mjs
    node scripts/fetch-yt-dlp.mjs --force
    YTDLP_ASSET=yt-dlp_musllinux node scripts/fetch-yt-dlp.mjs
*/
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = path.join(ROOT, "bin");
const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const MIN_SIZE_BYTES = 1024 * 1024;

function pickAssetName() {
  const fromEnv = String(process.env.YTDLP_ASSET || "").trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  return isMusl() ? "yt-dlp_musllinux" : "yt-dlp_linux";
}

function isMusl() {
  if (process.platform !== "linux") return false;
  try {
    const report = process.report?.getReport?.();
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const asset = pickAssetName();
  const target = path.join(BIN_DIR, asset);

  await fs.mkdir(BIN_DIR, { recursive: true });

  if (!force) {
    try {
      const stat = await fs.stat(target);
      if (stat.size > MIN_SIZE_BYTES) {
        console.log(`[yt-dlp] sudah ada: ${path.relative(ROOT, target)} (${Math.round(stat.size / 1024 / 1024)} MB), lewati unduhan.`);
        return;
      }
    } catch {
      // belum ada, lanjut unduh
    }
  }

  const url = `${RELEASE_BASE}/${asset}`;
  console.log(`[yt-dlp] mengunduh ${url} ...`);

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} saat unduh ${asset}`);
  }

  const tempPath = `${target}.download`;
  await pipeline(response.body, createWriteStream(tempPath));

  const stat = await fs.stat(tempPath);
  if (stat.size < MIN_SIZE_BYTES) {
    throw new Error(`File hasil unduhan terlalu kecil (${stat.size} byte), tampaknya rusak.`);
  }

  await fs.rm(target, { force: true });
  await fs.rename(tempPath, target);

  if (process.platform !== "win32") {
    await fs.chmod(target, 0o755);
  }

  console.log(`[yt-dlp] siap: ${path.relative(ROOT, target)} (${Math.round(stat.size / 1024 / 1024)} MB, standalone tanpa Python)`);
}

main().catch((error) => {
  // Jangan pernah gagalkan npm install karena unduhan yt-dlp
  console.warn(`[yt-dlp] unduhan dilewati: ${error instanceof Error ? error.message : error}`);
  console.warn("[yt-dlp] jalankan manual nanti: node scripts/fetch-yt-dlp.mjs");
});
