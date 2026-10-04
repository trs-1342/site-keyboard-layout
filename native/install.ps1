# SPDX-License-Identifier: GPL-3.0-only
# Installs the native messaging host for Site Keyboard Layout on Windows
# (current user only, no administrator rights needed).
#
#   powershell -ExecutionPolicy Bypass -File .\native\install.ps1
$ErrorActionPreference = "Stop"

$name = "site_keyboard_layout"
$extensionId = "site-keyboard-layout@trs-1342"
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
Copy-Item (Join-Path $PSScriptRoot "$name.py") (Join-Path $target "$name.py") -Force

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
