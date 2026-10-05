<#
.SYNOPSIS
  Build the zip the Team Lead deploys: the repo's source + the PRODUCTION .env (ADR 0004).

.DESCRIPTION
  Contents = every file git tracks or would track (git ls-files --cached --others --exclude-standard),
  so node_modules, build output, backups and every dev env file (.env, .env.dev, apps/*/.env*) stay out
  through .gitignore. The production env file is added as `.env` at the zip root - the TL only runs
  `docker compose up -d --build` (HANDOFF.md). Entry names use `/` and files are copied byte for byte,
  so shell scripts keep their LF line endings on the Linux server.

  The zip CONTAINS LIVE SECRETS (DB password, portal JWT secret, HMAC peppers). Send it like a password.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/handoff/make-handoff-zip.ps1
  powershell -ExecutionPolicy Bypass -File scripts/handoff/make-handoff-zip.ps1 -EnvFile .env.production -OutDir ..
#>
param(
  # The production env file (git-ignored). Written by you; see HANDOFF.md for every key.
  [string]$EnvFile = '.env.production',
  # Where the zip goes; default = the folder ABOVE the repo, so it can never be zipped into itself.
  [string]$OutDir = '..'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

# --- The production .env must be complete ------------------------------------
$envPath = Join-Path $repoRoot $EnvFile
if (-not (Test-Path $envPath)) { throw "Production env file not found: $envPath" }
$envText = [IO.File]::ReadAllText($envPath)
$placeholders = [regex]::Matches($envText, '(?m)^([A-Z_]+)=.*change-me.*$') | ForEach-Object { $_.Groups[1].Value }
if ($placeholders) { throw "$EnvFile still has change-me values: $($placeholders -join ', ')" }
if ($envText -notmatch '(?m)^DB_APP_ROLE_MODE=owner\s*$') { throw "$EnvFile must set DB_APP_ROLE_MODE=owner (production, ADR 0002)" }
if ($envText -match '(?m)^MIGRATION_DATABASE_URL=.*@postgres:') { throw "$EnvFile points at the LOCAL postgres container, not 10.150.0.5" }

# --- Collect the files -------------------------------------------------------
$files = git ls-files --cached --others --exclude-standard | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
if (-not $files) { throw 'git ls-files returned nothing - run this inside the repo' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$outDirFull = (Resolve-Path $OutDir).Path
$zipPath = Join-Path $outDirFull "nexus-traffic-handoff-$stamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $entryName = 'nexus-traffic/' + ($file -replace '\\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $repoRoot $file), $entryName, [IO.Compression.CompressionLevel]::Optimal)
  }
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $envPath, 'nexus-traffic/.env', [IO.Compression.CompressionLevel]::Optimal)
} finally {
  $zip.Dispose()
}

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "Wrote $zipPath ($($files.Count) files + .env, $sizeMb MB)"
Write-Host 'It contains LIVE SECRETS - share it like a password. TL steps: nexus-traffic/HANDOFF.md'
