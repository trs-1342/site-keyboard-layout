# SPDX-License-Identifier: GPL-3.0-only
# Removes the native messaging host for Site Keyboard Layout on Windows.
$ErrorActionPreference = "Stop"

$name = "site_keyboard_layout"
$target = Join-Path $env:LOCALAPPDATA "site-keyboard-layout"
$key = "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"

if (Test-Path $key) {
    Remove-Item -Path $key -Force
    Write-Host "Removed $key"
}
if (Test-Path $target) {
    Remove-Item -Path $target -Recurse -Force
    Write-Host "Removed $target"
}
