# ONE-TIME setup for automatic deploys on a WINDOWS server (the Linux version is setup-runner.sh).
# Same approach as EBO_SALES (ADR 0005). Run it from the server's git checkout of this repo (the
# folder holding .env and docker-compose.yml), in PowerShell opened with "Run as Administrator":
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-runner.ps1 -Token <RUNNER_TOKEN>
#
# Optional first: add -DryRun to only check prerequisites and show what it would do.
#
# <RUNNER_TOKEN> comes from the GitHub repo admin of NEXUS-TRAFFIC: Settings -> Actions -> Runners ->
# New self-hosted runner -> copy the value after `--token` (valid for 1 hour). It is NOT the EBO_SALES
# token: a runner belongs to one repo.
#
# What it does, so nobody has to do it by hand:
#   1. downloads the GitHub Actions runner into C:\actions-runner-nexus-traffic (EBO_SALES' runner
#      keeps C:\actions-runner; the two run side by side as separate services)
#   2. records this folder as DEPLOY_DIR for the runner (no GitHub variable needed)
#   3. registers it to this repo with the label `nexus-traffic-prod` (what deploy.yml targets)
#   4. installs it as a Windows service that runs as YOUR account (asks for your Windows password
#      once): that account already has Docker Desktop access. Use -RunAs to pick another account.
#
# It only makes outbound HTTPS connections to github.com; no inbound port is opened.
# Safe to re-run with a fresh token: this runner's registration is replaced (other runners are left alone).
#
# ASCII-only on purpose: Windows PowerShell 5.1 misreads UTF-8 files without a BOM.

param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$RunnerDir = 'C:\actions-runner-nexus-traffic',
    # Account the service runs as. Default: whoever runs this script. Pass a local/domain account
    # (e.g. '.\deploy' or 'CORP\svc-deploy') if yours is a Microsoft/Azure AD sign-in, which
    # Windows may refuse for services. It must be able to use Docker.
    [string]$RunAs = "$env:USERDOMAIN\$env:USERNAME",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest very slow on 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Label = 'nexus-traffic-prod'

function Log([string]$Message) { Write-Host "[setup-runner] $Message" }
function Fail([string]$Message) { Write-Host "[setup-runner] ERROR: $Message" -ForegroundColor Red; exit 1 }

# The Windows service(s) of THE runner in $RunnerDir only - never EBO_SALES' or any other runner.
function Get-OwnRunnerService([string]$Dir) {
    $own = @()
    $serviceFile = Join-Path $Dir '.service'
    if (Test-Path $serviceFile) {
        $name = "$(Get-Content $serviceFile -TotalCount 1)".Trim()
        if ($name) { $own += Get-Service -Name $name -ErrorAction SilentlyContinue }
    }
    $prefix = (Join-Path $Dir 'bin\').ToLowerInvariant()
    $own += Get-CimInstance Win32_Service -Filter "Name LIKE 'actions.runner.%'" |
        Where-Object { "$($_.PathName)".Trim('"').ToLowerInvariant().StartsWith($prefix) } |
        ForEach-Object { Get-Service -Name $_.Name -ErrorAction SilentlyContinue }
    return @($own | Where-Object { $_ } | Sort-Object Name -Unique)
}

# --- prerequisites -------------------------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'open PowerShell with "Run as Administrator" (it installs a Windows service)'
}
foreach ($cmd in 'git', 'docker') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd is not installed / not on PATH" }
}
# deploy.yml runs scripts/ci-deploy.sh through Git for Windows' bash (<Git>\cmd\git.exe -> <Git>\bin\bash.exe).
$gitDir = Split-Path (Get-Command git).Source
$bash = @((Join-Path $gitDir '..\bin\bash.exe'), (Join-Path $gitDir '..\..\bin\bash.exe'), "$env:ProgramFiles\Git\bin\bash.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $bash) { Fail 'Git Bash not found (install Git for Windows: it ships bin\bash.exe)' }

$ErrorActionPreference = 'Continue'   # native tools below are checked through $LASTEXITCODE
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Log 'WARNING: docker is not responding - start Docker Desktop before the first deploy' }

$DeployDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach ($f in 'docker-compose.yml', 'scripts\deploy.sh', 'scripts\ci-deploy.sh') {
    if (-not (Test-Path (Join-Path $DeployDir $f))) { Fail "run this from the repo checkout ($f missing in $DeployDir)" }
}
if (-not (Test-Path (Join-Path $DeployDir '.git'))) {
    Fail "$DeployDir is not a git checkout (an unpacked handoff zip?) - git clone the repo, copy .env and backups\ into it, run this from there (DEPLOY.md)"
}
if (-not (Test-Path (Join-Path $DeployDir '.env'))) {
    Log "WARNING: $DeployDir\.env is missing - deploys will fail until it exists (DEPLOY.md step 2)"
}

# `-c safe.directory=*`: an elevated prompt is a different owner than the folder's, which git
# would otherwise refuse as "dubious ownership".
$RepoUrl = "$(& git -c 'safe.directory=*' -C $DeployDir remote get-url origin)".Trim()
$RepoUrl = $RepoUrl -replace '\.git$', '' -replace '^git@github\.com:', 'https://github.com/'
if ($RepoUrl -notmatch '^https://github\.com/') { Fail "origin is not a GitHub repo: $RepoUrl" }

$RunnerName = "$env:COMPUTERNAME-nexus-traffic"
if ($RunnerName.Length -gt 64) { $RunnerName = $RunnerName.Substring(0, 64) }

$release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/actions/runner/releases/latest'
$Version = "$($release.tag_name)".TrimStart('v')
if (-not $Version) { Fail 'could not reach github.com to find the runner version (outbound HTTPS blocked?)' }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

Log "repo       = $RepoUrl"
Log "deploy dir = $DeployDir"
Log "git bash   = $bash"
Log "runner     = v$Version ($Arch) in $RunnerDir, name $RunnerName, label $Label"
Log "service as = $RunAs"
if ($DryRun) { Log 'Dry run: all checks passed, nothing was changed.'; exit 0 }

# --- 1. download ---------------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null
Set-Location -LiteralPath $RunnerDir

if (Test-Path '.runner') {
    # Un-registering needs a separate "remove" token, so drop the local registration instead;
    # `--replace` below then takes over the old runner entry on GitHub by name.
    Log 'existing registration found - replacing it'
    Get-OwnRunnerService $RunnerDir | ForEach-Object {
        Log "removing service $($_.Name)"
        Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
        & sc.exe delete $_.Name | Out-Null
    }
    Remove-Item -Force -ErrorAction SilentlyContinue '.runner', '.credentials', '.credentials_rsaparams', '.service'
}
if (-not (Test-Path '.\config.cmd')) {
    $zip = "actions-runner-win-$Arch-$Version.zip"
    Log "downloading $zip"
    Invoke-WebRequest -UseBasicParsing -OutFile $zip "https://github.com/actions/runner/releases/download/v$Version/$zip"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $RunnerDir $zip), $RunnerDir)
    Remove-Item $zip
}

# --- 2. where to deploy ----------------------------------------------------------------------------
# The runner exports its .env file to every job; deploy.yml reads DEPLOY_DIR from it. Written
# before registration because `--runasservice` starts the service straight away.
$envFile = Join-Path $RunnerDir '.env'
$lines = @()
if (Test-Path $envFile) { $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^DEPLOY_DIR=' }) }
$lines += "DEPLOY_DIR=$DeployDir"
Set-Content -Path $envFile -Value $lines -Encoding ASCII

# --- 3 + 4. register and install the service -------------------------------------------------------
# Docker Desktop only lets members of `docker-users` talk to it.
if (Get-LocalGroup -Name 'docker-users' -ErrorAction SilentlyContinue) {
    Add-LocalGroupMember -Group 'docker-users' -Member $RunAs -ErrorAction SilentlyContinue
}

$secure = Read-Host -AsSecureString "Windows password for $RunAs (the service runs as this account)"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

& .\config.cmd --unattended --replace `
    --url $RepoUrl --token $Token `
    --name $RunnerName --labels $Label --work _work `
    --runasservice --windowslogonaccount $RunAs --windowslogonpassword $plain
$code = $LASTEXITCODE
$plain = $null
if ($code -ne 0) {
    Fail "runner registration failed (exit $code) - token expired (get a new one), or Windows refused the account/password (try -RunAs with a local account)"
}

Log 'done. The runner should show as "Idle" under GitHub -> NEXUS-TRAFFIC -> Settings -> Actions -> Runners.'
Log 'Keep Docker Desktop running (Settings -> General -> "Start Docker Desktop when you sign in").'
Log 'From now on every push to main deploys here automatically (scripts/ci-deploy.sh).'
