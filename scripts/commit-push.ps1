<#
  Simpan + upload perubahan ke GitHub (tinggal pakai).
  Contoh:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\commit-push.ps1 -Message "rapikan tampilan"
#>
param(
  [Parameter(Mandatory = $true)][string]$Message,
  [string]$Branch = "main"
)

$ErrorActionPreference = "Continue"
$git = "git"
if (-not (Get-Command $git -ErrorAction SilentlyContinue)) {
  $git = "C:\Program Files\Git\cmd\git.exe"
}

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH
}

# identitas dipakai sementara, tidak mengubah git config global
if (-not (& $git config user.name)) {
  $env:GIT_AUTHOR_NAME = "wh9six"
  $env:GIT_AUTHOR_EMAIL = "wh9six@users.noreply.github.com"
  $env:GIT_COMMITTER_NAME = "wh9six"
  $env:GIT_COMMITTER_EMAIL = "wh9six@users.noreply.github.com"
}

Write-Output ">> menambah file..."
& $git add -A

& $git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Output ">> tidak ada perubahan baru, skip commit."
} else {
  & $git commit -m $Message
}

Write-Output ">> push ke origin $Branch ..."
& $git push -u origin $Branch
Write-Output ">> selesai (exit $LASTEXITCODE)."
