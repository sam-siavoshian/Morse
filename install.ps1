# Morse for Windows, in one line (in PowerShell):
#
#   irm https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install.ps1 | iex
#
# What it does, and nothing else:
#   1. checks that Node 22 or newer is here (it never installs system software;
#      it says how to get Node and stops)
#   2. downloads the small Morse package from the "preview" release on GitHub
#      and checks it against the release's SHA256SUMS (with no release yet, it
#      builds the package from the main branch instead, and says so)
#   3. puts Morse in ~\.morse\app and a morse command in npm's folder for
#      commands (%APPDATA%\npm, already on your PATH), or in ~\.morse\bin,
#      which it then adds to your PATH
#   4. runs `morse setup --auto`, which finds Claude Code or Codex
#   5. says what to do next
#
# Run it again to update. Remove Morse with `morse uninstall`, or:
#   $env:MORSE_UNINSTALL=1; irm https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install.ps1 | iex
#
# Run as a file, it takes -Uninstall [-All] and -NoSetup.
# Settings (for testing, or a mirror): MORSE_HOME, MORSE_BIN_DIR,
# MORSE_INSTALL_BASE, MORSE_INSTALL_SOURCE, MORSE_NO_SETUP, MORSE_UNINSTALL,
# MORSE_UNINSTALL_ALL.
#
# macOS and Linux: install.sh does the same.
param([switch]$Uninstall, [switch]$All, [switch]$NoSetup)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Windows PowerShell 5.1 downloads crawl with the progress bar on

function Install-Morse {
  param([bool]$Uninstall, [bool]$All, [bool]$NoSetup)

  $Repo = 'sam-siavoshian/RRAA'
  $Base = if ($env:MORSE_INSTALL_BASE) { $env:MORSE_INSTALL_BASE.TrimEnd('/') } else { "https://github.com/$Repo/releases/download/preview" }
  $Source = if ($env:MORSE_INSTALL_SOURCE) { $env:MORSE_INSTALL_SOURCE } else { "https://codeload.github.com/$Repo/tar.gz/refs/heads/main" }
  $MorseDir = if ($env:MORSE_HOME) { $env:MORSE_HOME } else { Join-Path $HOME '.morse' }
  $App = Join-Path $MorseDir 'app'
  $Ext = Join-Path $MorseDir 'chrome-extension' # older installs' Chrome extension: removed on update
  $Receipt = Join-Path $MorseDir 'install.txt'
  $Mark = 'Morse: added by the install line' # daemon/installed.js looks for it
  $PreviewPage = "https://github.com/$Repo/releases/tag/preview"

  function Step([string]$s) { Write-Host "  $s" }
  # Runs a program. Windows PowerShell 5.1 turns anything a program writes to
  # stderr into an error when it's redirected, so errors only count by exit code.
  function Run-Native([string]$file, [string[]]$argv, [switch]$Quiet) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      if ($Quiet) { $out = (& $file @argv 2>&1 | ForEach-Object { "$_" }) -join "`n" }
      else { & $file @argv | Out-Host; $out = '' }
      return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
    } finally { $ErrorActionPreference = $eap }
  }
  function Read-Receipt {
    $r = @{}
    if (Test-Path -LiteralPath $Receipt) {
      foreach ($line in [IO.File]::ReadAllLines($Receipt)) { if ($line -match '^([a-z0-9_]+)=(.*)$') { $r[$Matches[1]] = $Matches[2].Trim() } }
    }
    return $r
  }
  function Test-Ours([string]$file) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
    $head = (Get-Content -LiteralPath $file -TotalCount 3 -ErrorAction SilentlyContinue) -join "`n"
    return $head.Contains($Mark)
  }
  function Same-Dir([string]$a, [string]$b) { return $a.TrimEnd('\').ToLowerInvariant() -eq $b.TrimEnd('\').ToLowerInvariant() }
  function On-Path([string]$dir) {
    foreach ($p in ($env:Path -split ';')) { if ($p -and (Same-Dir $p $dir)) { return $true } }
    return $false
  }

  # ------------------------------------------------------------ uninstall
  if ($Uninstall) {
    $r = Read-Receipt
    if (-not (Test-Path -LiteralPath $Receipt) -and -not (Test-Path -LiteralPath $App)) {
      Write-Host "Morse isn't installed by this installer here ($MorseDir), so there is nothing to remove."
      return
    }
    if ($r.shim -and (Test-Ours $r.shim)) { Remove-Item -LiteralPath $r.shim -Force; Step "Removed $($r.shim)" }
    if ($r.path_added) {
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      if ($userPath) {
        $kept = ($userPath -split ';' | Where-Object { $_ -and -not (Same-Dir $_ $r.path_added) }) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $kept, 'User')
        Step "Took $($r.path_added) out of your PATH"
      }
      if ((Test-Path -LiteralPath $r.path_added) -and -not (Get-ChildItem -LiteralPath $r.path_added -Force)) { Remove-Item -LiteralPath $r.path_added -Force }
    }
    foreach ($d in @($App, $Ext, (Join-Path $MorseDir '.app-new'), (Join-Path $MorseDir '.extension-new'))) {
      if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
    }
    Step "Removed $App and $Ext"
    if ($All) {
      Remove-Item -LiteralPath $MorseDir -Recurse -Force -ErrorAction SilentlyContinue
      Step "Removed $MorseDir (your mods and settings)"
    } else {
      Remove-Item -LiteralPath $Receipt -Force -ErrorAction SilentlyContinue
      Step "Your mods and settings are still in $MorseDir. Delete that folder to remove them too."
    }
    Write-Host 'Morse is removed.'
    return
  }

  # ------------------------------------------------------------ checks
  Write-Host 'Installing Morse'
  $have = ''
  $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($node) { $node = $node.Source; $have = (Run-Native $node @('-p', 'process.versions.node') -Quiet).Out.Trim() }
  $major = 0
  if ($have -match '^(\d+)\.') { $major = [int]$Matches[1] }
  if ($major -lt 22) {
    $why = if ($have) { "Morse needs Node 22 or newer. This computer has Node $have." } else { "Morse needs Node 22 or newer, and this computer doesn't have it yet." }
    throw "$why`n  Get it one of these ways, then run the same line again in a new PowerShell window:`n    - winget install OpenJS.NodeJS.LTS`n    - or download the installer from https://nodejs.org (the LTS version)"
  }
  # npm.cmd, not npm: PowerShell would pick npm.ps1, which a locked-down computer refuses to run.
  # (Plain npm is for PowerShell on macOS and Linux, where the tests run this script.)
  $npm = Get-Command npm.cmd, npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $npm) { throw "Morse needs npm, which comes with Node, but it isn't on your PATH. Reinstall Node from https://nodejs.org, then run the same line again." }
  $npm = $npm.Source
  # Windows' own tar.exe, not one from Git for Windows (which misreads C:\ paths).
  $tar = if ($env:SystemRoot) { Join-Path $env:SystemRoot 'System32\tar.exe' } else { '' }
  if (-not $tar -or -not (Test-Path -LiteralPath $tar)) {
    $t = Get-Command tar -ErrorAction SilentlyContinue
    if (-not $t) { throw "Morse's installer needs tar, which comes with Windows 10 (1803) and newer. Update Windows, then run the same line again." }
    $tar = $t.Source
  }
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }

  function Get-File([string]$url, [string]$file) {
    if ($url -notmatch '^https://' -and $url -notmatch '^http://(127\.0\.0\.1|localhost)[:/]') { throw "Won't download from ${url}: only https addresses." }
    Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  }
  function Status-Of($err) {
    try { return [int]$err.Exception.Response.StatusCode } catch { return 0 }
  }
  function Hash-Of([string]$file) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("morse-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $stage = Join-Path $MorseDir '.app-new'
  try {
    # -------------------------------------------------------- the package
    $pkg = Join-Path $tmp 'morse-cli.tgz'
    $from = 'release'
    $haveRelease = $true
    try { Get-File "$Base/SHA256SUMS" (Join-Path $tmp 'SHA256SUMS') }
    catch {
      if ((Status-Of $_) -eq 404) { $haveRelease = $false }
      else { throw "Couldn't reach GitHub to download Morse ($($_.Exception.Message)). Check your internet connection and run the same line again." }
    }
    if ($haveRelease) {
      Step 'Downloading Morse...'
      try { Get-File "$Base/morse-cli.tgz" $pkg } catch { throw "Couldn't download $Base/morse-cli.tgz ($($_.Exception.Message)). Run the same line again in a minute." }
      $want = ''
      foreach ($line in [IO.File]::ReadAllLines((Join-Path $tmp 'SHA256SUMS'))) {
        if ($line -match '^([0-9a-fA-F]{64})[ *]+morse-cli\.tgz$') { $want = $Matches[1].ToLowerInvariant(); break }
      }
      if (-not $want) { throw "The release's SHA256SUMS has no line for morse-cli.tgz, so the download can't be checked. Nothing was installed." }
      $got = Hash-Of $pkg
      if ($got -ne $want) { throw "The download doesn't match its checksum, so it wasn't installed.`n  expected $want`n  got      $got`n  Run the same line again. If it still fails, tell us: https://github.com/$Repo/issues" }
      Step "Checked the download against the release's SHA256SUMS."
    } else {
      $from = 'main'
      Step 'No preview release yet, so Morse is built from the main branch (a bigger download, about a minute).'
      $src = Join-Path $tmp 'src'
      New-Item -ItemType Directory -Path $src | Out-Null
      try { Get-File $Source (Join-Path $tmp 'main.tar.gz') } catch { throw "Couldn't download Morse from $Source ($($_.Exception.Message))." }
      if ((Run-Native $tar @('-xzf', (Join-Path $tmp 'main.tar.gz'), '-C', $src, '--exclude', '*/docs/*')).Code -ne 0) { throw 'Unpacking the main branch failed. Nothing was installed.' }
      $root = Get-ChildItem -LiteralPath $src -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') } | Select-Object -First 1
      if (-not $root) { throw "The download from $Source isn't the Morse source. Nothing was installed." }
      Step 'Building Morse...'
      Push-Location $root.FullName
      try {
        $b = Run-Native $npm @('ci', '--no-audit', '--no-fund', '--loglevel=error') -Quiet
        if ($b.Code -ne 0) { Write-Host $b.Out; throw 'Building Morse from the main branch failed (above).' }
        $b = Run-Native $npm @('pack', '--pack-destination', $tmp) -Quiet
        if ($b.Code -ne 0) { Write-Host $b.Out; throw 'Packing Morse failed (above).' }
      } finally { Pop-Location }
      $made = Get-ChildItem -LiteralPath $tmp -Filter 'morse-cli-*.tgz' | Select-Object -First 1
      if (-not $made) { throw 'Building Morse made no package. Nothing was installed.' }
      Move-Item -LiteralPath $made.FullName -Destination $pkg
    }
    $sha = Hash-Of $pkg

    # -------------------------------------------------------- unpack and swap
    New-Item -ItemType Directory -Path $MorseDir -Force | Out-Null
    $r = Read-Receipt
    $cli = Join-Path $App 'daemon\cli.js'
    if (($r.sha256 -eq $sha) -and (Test-Path -LiteralPath $cli)) {
      $status = 'already up to date'
    } else {
      $status = if (Test-Path -LiteralPath $cli) { 'updated' } else { 'installed' }
      if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
      New-Item -ItemType Directory -Path $stage | Out-Null
      if ((Run-Native $tar @('-xzf', $pkg, '-C', $stage)).Code -ne 0) { throw 'Unpacking the package failed. Nothing was installed.' }
      $new = Join-Path $stage 'package'
      if (-not (Test-Path -LiteralPath (Join-Path $new 'daemon\cli.js'))) { throw 'The package has no Morse in it. Nothing was installed.' }
      Step "Getting Morse's one dependency from npm..."
      Push-Location $new
      try {
        $b = Run-Native $npm @('install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error') -Quiet
        if ($b.Code -ne 0) { Write-Host $b.Out; throw "npm couldn't get Morse's dependency (above). Check your internet connection and run the same line again." }
      } finally { Pop-Location }
      $old = "$App.old"
      if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
      if (Test-Path -LiteralPath $App) { Move-Item -LiteralPath $App -Destination $old }
      Move-Item -LiteralPath $new -Destination $App
      Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }

    # An older install's Chrome extension: Morse no longer has one.
    foreach ($d in @($Ext, (Join-Path $MorseDir '.extension-new'))) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }

    # -------------------------------------------------------- the morse command
    # MORSE_BIN_DIR; else npm's folder for commands when it's on PATH (it is,
    # after the Node installer); else ~\.morse\bin, added to your PATH.
    $pathAdded = ''
    if ($env:MORSE_BIN_DIR) { $bin = $env:MORSE_BIN_DIR }
    else {
      $npmBin = (Run-Native $npm @('prefix', '-g') -Quiet).Out.Trim()
      if ($npmBin -and (On-Path $npmBin) -and (Test-Path -LiteralPath $npmBin)) { $bin = $npmBin }
      else {
        $bin = Join-Path $MorseDir 'bin'
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (-not (($userPath -split ';') | Where-Object { $_ -and (Same-Dir $_ $bin) })) {
          [Environment]::SetEnvironmentVariable('Path', ((@($userPath, $bin) | Where-Object { $_ }) -join ';'), 'User')
          $pathAdded = $bin
        } elseif ($r.path_added) { $pathAdded = $r.path_added }
        if (-not (On-Path $bin)) { $env:Path = "$env:Path;$bin" }
      }
    }
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $shim = Join-Path $bin 'morse.cmd'
    if ((Test-Path -LiteralPath $shim) -and -not (Test-Ours $shim)) {
      Step "! There is already a morse command at $shim that this installer didn't make, so it was left alone."
      Step "  This Morse runs with: node `"$cli`""
      $shim = ''
    } else {
      # One line runs Morse; "& exit /b" keeps cmd from reading the file again
      # after it (morse uninstall deletes it while it runs).
      # %USERPROFILE% rather than the folder's name: cmd.exe misreads names with accents.
      $cliRef = if ($env:USERPROFILE -and $cli.StartsWith($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase)) { '%USERPROFILE%' + $cli.Substring($env:USERPROFILE.Length) } else { $cli }
      $lines = @('@echo off', "rem $Mark. morse uninstall removes it.", "node `"$cliRef`" %* & exit /b")
      [IO.File]::WriteAllLines($shim, $lines)
    }
    $version = (Run-Native $node @($cli, '--version') -Quiet).Out.Trim()
    $lines = @(
      "# $Mark. morse uninstall removes what is listed here.",
      "version=$version", "sha256=$sha", "source=$from", "app=$App", "shim=$shim",
      "path_added=$pathAdded", "installed=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"
    )
    [IO.File]::WriteAllLines($Receipt, $lines)
    $where = if ($shim) { ": $shim" } else { '' }
    Step "Morse $version $status$where"
    if ($pathAdded) { Step "Added $pathAdded to your PATH. New terminals find the morse command." }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (-not $NoSetup) {
    Write-Host ''
    # Start-Process: setup talks to this window directly, so its questions show as it asks them.
    $p = Start-Process -FilePath $node -ArgumentList "`"$cli`" setup --auto" -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { Step "! morse setup didn't finish. Run it again any time: morse setup" }
  }

  Write-Host ''
  Write-Host 'Next:'
  Write-Host '  1. Open an app or your browser with Morse: morse launch obsidian, or morse launch chrome'
  Write-Host "     (or the Morse app: $PreviewPage)"
  Write-Host '  2. Press Ctrl+Shift+Space in it, point at something, and say what to change.'
}

# Run as a file (-File), a failure ends with exit code 1. Through `irm | iex`
# it only prints the message: exit would close the person's PowerShell window.
$asFile = [bool]$MyInvocation.MyCommand.Path
$un = $Uninstall.IsPresent -or [bool]$env:MORSE_UNINSTALL
$everything = $All.IsPresent -or [bool]$env:MORSE_UNINSTALL_ALL
$skip = $NoSetup.IsPresent -or [bool]$env:MORSE_NO_SETUP
try {
  Install-Morse -Uninstall $un -All $everything -NoSetup $skip
} catch {
  Write-Host ''
  Write-Host "x $($_.Exception.Message)" -ForegroundColor Red
  if ($asFile) { exit 1 }
} finally {
  Remove-Item Env:\MORSE_UNINSTALL -ErrorAction SilentlyContinue
  Remove-Item Env:\MORSE_UNINSTALL_ALL -ErrorAction SilentlyContinue
}
