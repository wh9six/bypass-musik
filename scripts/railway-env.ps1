<#
  Bikin file variabel Railway yang tinggal tempel.
  Dibaca: .env lokal (API key + kode admin) dan cookies.json (dipadatkan jadi 1 baris).
  Hasil : railway-variables.txt  (file ini sudah masuk .gitignore, jangan di-commit)

  Cara pakai (PowerShell, dari folder project):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\railway-env.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\railway-env.ps1 -Domain https://tokoku.up.railway.app
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\railway-env.ps1 -NoVolume   # kalau tidak pasang Volume
#>
param(
  [string]$EnvFile = ".env",
  [string]$CookiesFile = "cookies.json",
  [string]$OutFile = "railway-variables.txt",
  [string]$Domain = "",
  [switch]$NoVolume
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Read-DotEnv([string]$path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  foreach ($line in Get-Content $path -Encoding UTF8) {
    $text = $line.Trim()
    if (-not $text -or $text.StartsWith("#")) { continue }
    $index = $text.IndexOf("=")
    if ($index -lt 1) { continue }
    $key = $text.Substring(0, $index).Trim()
    $value = $text.Substring($index + 1).Trim().Trim('"')
    $map[$key] = $value
  }
  return $map
}

$envMap = Read-DotEnv $EnvFile
$adminCode = if ($envMap["ADMIN_CODE"]) { $envMap["ADMIN_CODE"] } else { "ganti-kode-admin-ini" }
$robloxKey = if ($envMap["ROBLOX_API_KEY"]) { $envMap["ROBLOX_API_KEY"] } else { "" }
$creatorUser = if ($envMap["ROBLOX_CREATOR_USER_ID"]) { $envMap["ROBLOX_CREATOR_USER_ID"] } else { "" }
$creatorGroup = if ($envMap["ROBLOX_CREATOR_GROUP_ID"]) { $envMap["ROBLOX_CREATOR_GROUP_ID"] } else { "" }

if ($Domain) {
  $corsOrigin = $Domain.TrimEnd("/")
} elseif ($envMap["CORS_ALLOW_ORIGINS"] -and $envMap["CORS_ALLOW_ORIGINS"] -ne "*") {
  $corsOrigin = $envMap["CORS_ALLOW_ORIGINS"]
} else {
  $corsOrigin = "*"
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("ADMIN_CODE=$adminCode")
if ($robloxKey) { $lines.Add("ROBLOX_API_KEY=$robloxKey") }
if ($creatorUser) { $lines.Add("ROBLOX_CREATOR_USER_ID=$creatorUser") }
if ($creatorGroup) { $lines.Add("ROBLOX_CREATOR_GROUP_ID=$creatorGroup") }
$lines.Add("CORS_ALLOW_ORIGINS=$corsOrigin")

# Cookie YouTube dipadatkan jadi satu baris JSON (Railway tidak menerima nilai multi-baris)
$cookieCount = 0
if (Test-Path $CookiesFile) {
  try {
    $cookies = Get-Content $CookiesFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cookies -is [array]) {
      $cookieCount = $cookies.Count
      $compact = $cookies | ConvertTo-Json -Compress -Depth 5
      $lines.Add("YTDL_COOKIES_JSON=$compact")
    }
  } catch {
    Write-Warning "Gagal membaca $CookiesFile, lewati YTDL_COOKIES_JSON."
  }
}

# yt-dlp tidak boleh ambil cookie dari browser karena di server tidak ada Chrome
$lines.Add("YTDLP_COOKIES_FROM_BROWSER=")

if (-not $NoVolume) {
  $lines.Add("UPLOAD_HISTORY_FILE=/data/upload-history.json")
  $lines.Add("AUTH_SESSIONS_FILE=/data/auth-sessions.json")
  $lines.Add("AUTH_USERS_FILE=/data/auth-users.json")
  $lines.Add("STUDIO_SETTINGS_FILE=/data/studio-settings.json")
  $lines.Add("ROBLOX_API_KEY_STORE_FILE=/data/roblox-api-key.json")
  $lines.Add("YTDL_COOKIES_FILE=/data/cookies.json")
}

Set-Content -Path $OutFile -Value ($lines -join "`r`n") -Encoding UTF8

$maskedKey = if ($robloxKey) { "$($robloxKey.Substring(0,4))...$($robloxKey.Substring($robloxKey.Length-4))" } else { "(kosong - isi nanti dari dashboard admin /admin)" }
Write-Output ""
Write-Output "File siap tempel : $((Resolve-Path $OutFile).Path)"
Write-Output "ADMIN_CODE       : $adminCode"
Write-Output "ROBLOX_API_KEY   : $maskedKey"
Write-Output "Cookies          : $cookieCount item (jadi 1 baris YTDL_COOKIES_JSON)"
Write-Output "CORS             : $corsOrigin"
if ($NoVolume) {
  Write-Output "Volume           : TIDAK dipakai (data hilang tiap redeploy)"
} else {
  Write-Output "Volume           : path /data (buat Volume di Railway lalu mount ke /data)"
}
Write-Output ""
Write-Output "Tempel isinya ke Railway > Service > Variables > 'Add Multiple Variables'."
Write-Output "Setelah Railway punya domain public, ganti CORS_ALLOW_ORIGINS dengan domain itu."
