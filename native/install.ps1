# SPDX-License-Identifier: GPL-3.0-only
# Installs the native messaging host for Site Keyboard Layout on Windows
# (current user only, no administrator rights needed).
#
#   powershell -ExecutionPolicy Bypass -File .\native\install.ps1
#
# It can also be run without downloading the project first:
#   irm https://raw.githubusercontent.com/trs-1342/site-keyboard-layout/v2.0.0/native/install.ps1 | iex
# In that case the helper program is fetched from the same release and its
# checksum is verified before anything is installed.
$ErrorActionPreference = "Stop"

$name = "site_keyboard_layout"
$extensionId = "site-keyboard-layout@trs-1342"
$version = "2.0.0"
$helperSha256 = "569c5675e25666c6e69c2d451a81b1db4488238b14b3400c82df3161814effbb"
$baseUrl = "https://raw.githubusercontent.com/trs-1342/site-keyboard-layout/v$version/native"
$target = Join-Path $env:LOCALAPPDATA "site-keyboard-layout"

$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $python -or $python.Source -like "*\WindowsApps\*") {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        $pythonPath = (& $launcher.Source -3 -c "import sys; print(sys.executable)").Trim()
    } else {
        throw "Python 3 is required. Install it from https://www.python.org/downloads/ and run this script again."
    }
} else {
    $pythonPath = $python.Source
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
$destination = Join-Path $target "$name.py"
$local = if ($PSScriptRoot) { Join-Path $PSScriptRoot "$name.py" } else { $null }
if ($local -and (Test-Path $local)) {
    Copy-Item $local $destination -Force
} else {
    # Piped into PowerShell: fetch the helper and verify it before use.
    $tmp = Join-Path $target "$name.download"
    Invoke-WebRequest -Uri "$baseUrl/$name.py" -OutFile $tmp -UseBasicParsing
    # Hash the text with line endings normalised, as Git may deliver CRLF.
    $text = [System.IO.File]::ReadAllText($tmp).Replace("`r`n", "`n")
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($text)
    $hash = -join ([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
    if ($hash -ne $helperSha256) {
        Remove-Item $tmp -Force
        throw "Checksum mismatch, nothing installed."
    }
    Move-Item $tmp $destination -Force
}

# Firefox can only start an .exe or .bat, so a small wrapper launches Python.
$bat = Join-Path $target "$name.bat"
Set-Content -Path $bat -Encoding ASCII -Value "@echo off`r`n`"$pythonPath`" -I `"%~dp0$name.py`" %*"

$manifestPath = Join-Path $target "$name.json"
$manifest = [ordered]@{
    name               = $name
    description        = "Keyboard layout switcher for the Site Keyboard Layout extension"
    path               = $bat
    type               = "stdio"
    allowed_extensions = @($extensionId)
}
$json = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

$key = "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name "(Default)" -Value $manifestPath

Write-Host "Installed to $target"
Write-Host "Registered in $key"
