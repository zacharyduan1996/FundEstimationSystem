param(
  [int]$Port = 3000,
  [string]$DatabasePath = "",
  [ValidateSet("auto", "background")] [string]$StartMode = "auto",
  [string]$ServiceName = "fund-valuation-demo",
  [int]$NodeMajor = 22,
  [ValidateSet("cn", "official")] [string]$NodeMirror = "cn",
  [string]$NpmRegistry = "https://registry.npmmirror.com",
  [ValidateSet("on", "off")] [string]$FastStart = "on",
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeNodeDir = Join-Path $AppDir ".runtime\node"
$NodeDistBaseUrlSelected = $null
if ([string]::IsNullOrWhiteSpace($DatabasePath)) {
  $DatabasePath = Join-Path $AppDir "fund-valuation.db"
}

function Write-Log {
  param([string]$Message)
  Write-Host "[bootstrap] $Message"
}

function Fail {
  param([string]$Message)
  Write-Error "[bootstrap] $Message"
  exit 1
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Elevation {
  if (Test-IsAdmin) {
    return
  }

  Write-Log "Requesting administrator permission..."
  $argList = @(
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-Port", "$Port",
    "-DatabasePath", "`"$DatabasePath`"",
    "-StartMode", "$StartMode",
    "-ServiceName", "`"$ServiceName`"",
    "-NodeMajor", "$NodeMajor",
    "-NodeMirror", "$NodeMirror",
    "-NpmRegistry", "`"$NpmRegistry`"",
    "-FastStart", "$FastStart"
  )

  if ($SkipBuild) {
    $argList += "-SkipBuild"
  }

  Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs
  exit 0
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
  Ensure-PortableNodePath
}

function Ensure-PortableNodePath {
  $portableBin = $RuntimeNodeDir
  if (Test-Path (Join-Path $RuntimeNodeDir "node.exe")) {
    if ($env:Path -notlike "*$portableBin*") {
      $env:Path = "$portableBin;$env:Path"
    }
  }
}

function Get-NodeDistBaseUrls {
  if ($NodeMirror -eq "official") {
    return @("https://nodejs.org/dist", "https://npmmirror.com/mirrors/node")
  }
  return @("https://npmmirror.com/mirrors/node", "https://nodejs.org/dist")
}

function Get-NodeZipDistName {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  switch ($arch) {
    "x64" { return "win-x64" }
    "arm64" { return "win-arm64" }
    default { throw "Unsupported Windows architecture: $arch" }
  }
}

function Resolve-LatestNodeVersion {
  $tmpFile = Join-Path $env:TEMP "fund-node-index-$PID.tab"
  try {
    foreach ($baseUrl in (Get-NodeDistBaseUrls)) {
      $indexUrl = "$baseUrl/index.tab"
      try {
        Invoke-WebRequest -Uri $indexUrl -OutFile $tmpFile -UseBasicParsing | Out-Null
      }
      catch {
        Write-Log "Node index unavailable on $baseUrl, trying next source..."
        continue
      }

      $prefix = "v$NodeMajor."
      $line = Get-Content $tmpFile | Select-Object -Skip 1 | Where-Object { $_.StartsWith($prefix) } | Select-Object -First 1
      if ($line) {
        $script:NodeDistBaseUrlSelected = $baseUrl
        return ($line -split "`t")[0]
      }

      Write-Log "Node index does not include v$NodeMajor on $baseUrl, trying next source..."
    }
    throw "No Node.js $NodeMajor.x version available from configured mirrors."
  }
  finally {
    if (Test-Path $tmpFile) {
      Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    }
  }
}

function Install-PortableNode {
  $zipPath = $null
  try {
    $version = Resolve-LatestNodeVersion
    $distName = Get-NodeZipDistName
    $baseUrl = if ($script:NodeDistBaseUrlSelected) { $script:NodeDistBaseUrlSelected } else { (Get-NodeDistBaseUrls)[0] }
    $zipName = "node-$version-$distName.zip"
    $zipUrl = "$baseUrl/$version/$zipName"
    $zipPath = Join-Path $env:TEMP $zipName
    $extractDir = Join-Path $AppDir ".runtime\node-$version-$distName"

    Write-Log "Installing portable Node.js $version ($distName) into project runtime..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing | Out-Null

    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    if (Test-Path $RuntimeNodeDir) { Remove-Item $RuntimeNodeDir -Recurse -Force }
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $extractDir) -Force
    Expand-Archive -Path $zipPath -DestinationPath (Split-Path -Parent $extractDir) -Force
    Rename-Item -Path $extractDir -NewName "node"
    Ensure-PortableNodePath
    Refresh-ProcessPath
    Ensure-NodeCommands
    return $true
  }
  catch {
    Write-Log "Portable Node install failed: $($_.Exception.Message)"
    return $false
  }
  finally {
    if ($zipPath -and (Test-Path $zipPath)) {
      Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Ensure-NodeCommands {
  Refresh-ProcessPath
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $nodeCmd -or -not $npmCmd) {
    Fail "node/npm command not found after installation."
  }
}

function Test-NodeReady {
  Refresh-ProcessPath
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $nodeCmd -or -not $npmCmd) {
    return $false
  }

  $major = [int](& node -p "process.versions.node.split('.')[0]")
  return $major -ge $NodeMajor
}

function Test-ServiceHealthy {
  try {
    Invoke-WebRequest -Uri "http://localhost:$Port/api/v1/system/status" -UseBasicParsing | Out-Null
    return $true
  }
  catch {
    return $false
  }
}

function Ensure-Node {
  Refresh-ProcessPath
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $major = [int](& node -p "process.versions.node.split('.')[0]")
    if ($major -ge $NodeMajor) {
      Write-Log "Node.js $major detected, skip install"
      return
    }
  }

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      Write-Log "Installing Node.js LTS via winget..."
      winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
      Ensure-NodeCommands
      return
    }
    catch {
      Write-Log "winget install failed, fallback to portable Node runtime"
    }
  }

  if (Get-Command choco -ErrorAction SilentlyContinue) {
    try {
      Write-Log "Installing Node.js LTS via Chocolatey..."
      choco install nodejs-lts -y
      Ensure-NodeCommands
      return
    }
    catch {
      Write-Log "Chocolatey install failed, fallback to portable Node runtime"
    }
  }

  if (Install-PortableNode) {
    Write-Log "Node.js installed via portable runtime fallback"
    return
  }

  Fail "Node.js install failed: winget/choco unavailable and portable install failed."
}

function Invoke-NpmInstall {
  param(
    [ValidateSet("ci", "install")] [string]$Mode
  )

  $succeeded = $false
  if (-not [string]::IsNullOrWhiteSpace($NpmRegistry)) {
    Write-Log "Installing npm dependencies via registry: $NpmRegistry"
    try {
      if ($Mode -eq "ci") {
        npm ci --registry $NpmRegistry
      }
      else {
        npm install --registry $NpmRegistry
      }
      $succeeded = $true
    }
    catch {
      $succeeded = $false
    }
  }

  if (-not $succeeded) {
    Write-Log "Retrying npm $Mode with default registry..."
    if ($Mode -eq "ci") {
      npm ci
    }
    else {
      npm install
    }
  }
}

function Touch-File {
  param([string]$Path)
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) {
    $null = New-Item -ItemType Directory -Path $dir -Force
  }
  if (Test-Path $Path) {
    (Get-Item $Path).LastWriteTimeUtc = [DateTime]::UtcNow
  }
  else {
    $null = New-Item -ItemType File -Path $Path -Force
  }
}

function Test-PathNewerThan {
  param(
    [string]$Path,
    [datetime]$RefTime
  )

  if (-not (Test-Path $Path)) {
    return $false
  }

  $item = Get-Item $Path
  if (-not $item.PSIsContainer) {
    return $item.LastWriteTimeUtc -gt $RefTime
  }

  $newer = Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -gt $RefTime } |
    Select-Object -First 1
  return $null -ne $newer
}

function Test-ManifestChangedSince {
  param([string]$StampPath)

  if (-not (Test-Path $StampPath)) {
    return $true
  }

  $stampTime = (Get-Item $StampPath).LastWriteTimeUtc
  return (
    (Test-PathNewerThan -Path (Join-Path $AppDir "package.json") -RefTime $stampTime) -or
    (Test-PathNewerThan -Path (Join-Path $AppDir "package-lock.json") -RefTime $stampTime)
  )
}

function Test-BuildChangedSince {
  param([string]$StampPath)

  if (-not (Test-Path $StampPath)) {
    return $true
  }

  $stampTime = (Get-Item $StampPath).LastWriteTimeUtc
  $paths = @(
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "app",
    "components",
    "lib"
  )

  foreach ($relativePath in $paths) {
    $fullPath = Join-Path $AppDir $relativePath
    if (Test-PathNewerThan -Path $fullPath -RefTime $stampTime) {
      return $true
    }
  }

  return $false
}

function Ensure-BuildTools {
  Ensure-Elevation
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Log "Installing Visual Studio Build Tools (for better-sqlite3)..."
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent --accept-package-agreements --accept-source-agreements `
      --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    return
  }

  if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Log "Installing Visual Studio Build Tools and Python via Chocolatey..."
    choco install visualstudio2022buildtools visualstudio2022-workload-vctools python -y
    return
  }

  Fail "Build tools install failed: neither winget nor choco was found."
}

function Wait-ForServer {
  for ($i = 0; $i -lt 25; $i++) {
    try {
      Invoke-WebRequest -Uri "http://localhost:$Port/api/v1/system/status" -UseBasicParsing | Out-Null
      Write-Log "Service is ready at http://localhost:$Port"
      Start-Process "http://localhost:$Port" | Out-Null
      return
    }
    catch {
      Start-Sleep -Seconds 1
    }
  }

  Write-Log "Service started, but readiness check timed out. Open http://localhost:$Port manually."
}

function Install-AppDependencies {
  Write-Log "Installing npm dependencies..."
  Push-Location $AppDir
  try {
    Ensure-NodeCommands
    $runDir = Join-Path $AppDir "run"
    $null = New-Item -ItemType Directory -Path $runDir -Force
    $depsStamp = Join-Path $runDir "deps.ready"
    $buildStamp = Join-Path $runDir "build.ready"

    $depsNeedInstall = $true
    if ($FastStart -eq "on" -and (Test-Path (Join-Path $AppDir "node_modules")) -and -not (Test-ManifestChangedSince -StampPath $depsStamp)) {
      $depsNeedInstall = $false
    }

    $installSucceeded = $false
    if (-not $depsNeedInstall) {
      Write-Log "Dependencies unchanged, skip npm install"
      $installSucceeded = $true
    }
    else {
      try {
        if (Test-Path (Join-Path $AppDir "package-lock.json")) {
          Invoke-NpmInstall -Mode "ci"
        }
        else {
          Invoke-NpmInstall -Mode "install"
        }
        $installSucceeded = $true
      }
      catch {
        $message = $_.Exception.Message
        if ($message -match "gyp|better-sqlite3|node-gyp|C\+\+") {
          Write-Log "Detected native build dependency issue, trying to install build tools..."
          Ensure-BuildTools
          if (Test-Path (Join-Path $AppDir "package-lock.json")) {
            Invoke-NpmInstall -Mode "ci"
          }
          else {
            Invoke-NpmInstall -Mode "install"
          }
          $installSucceeded = $true
        }
      }
    }

    if (-not $installSucceeded) {
      Fail "npm dependency install failed."
    }

    if ($depsNeedInstall) {
      Touch-File -Path $depsStamp
    }

    if (-not $SkipBuild) {
      $buildNeed = $true
      if ($FastStart -eq "on" -and (Test-Path (Join-Path $AppDir ".next\BUILD_ID")) -and -not (Test-BuildChangedSince -StampPath $buildStamp)) {
        $buildNeed = $false
      }

      if ($buildNeed) {
        Write-Log "Building Next.js app..."
        npm run build
        Touch-File -Path $buildStamp
      }
      else {
        Write-Log "Build artifacts are fresh, skip npm run build"
      }
    }
  }
  finally {
    Pop-Location
  }
}

function Start-Background {
  Write-Log "Starting app in background mode..."
  $runDir = Join-Path $AppDir "run"
  $logDir = Join-Path $AppDir "logs"
  $null = New-Item -ItemType Directory -Path $runDir -Force
  $null = New-Item -ItemType Directory -Path $logDir -Force

  $pidFile = Join-Path $runDir "$ServiceName.pid"
  if (Test-Path $pidFile) {
    $oldPidText = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPidText) {
      $oldPid = [int]$oldPidText
      $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      if ($oldProc) {
        Stop-Process -Id $oldPid -Force
      }
    }
  }

  $logFile = Join-Path $logDir "$ServiceName.log"
  $cmd = "cd /d `"$AppDir`" && set NODE_ENV=production && set PORT=$Port && set DATABASE_PATH=$DatabasePath && set TZ=Asia/Shanghai && npm run start -- --port $Port >> `"$logFile`" 2>&1"
  $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -WindowStyle Hidden -PassThru
  Set-Content -Path $pidFile -Value $proc.Id

  Write-Log "App started. PID=$($proc.Id)"
  Write-Log "Log file: $logFile"
  Wait-ForServer
}

Write-Log "App directory: $AppDir"
Write-Log "Database path: $DatabasePath"
Write-Log "Port: $Port"

if ($FastStart -eq "on" -and (Test-ServiceHealthy)) {
  Write-Log "Service already running and healthy, skip bootstrap"
  Start-Process "http://localhost:$Port" | Out-Null
  Write-Log "Done."
  exit 0
}

Ensure-Node
Install-AppDependencies
Start-Background

Write-Log "Done."
