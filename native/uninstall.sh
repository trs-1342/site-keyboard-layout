#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Removes the native messaging host. Run with sudo to remove a system install.
set -euo pipefail

name="site_keyboard_layout"

if [ "$(id -u)" -eq 0 ]; then
  targets=(
    "/usr/lib/mozilla/native-messaging-hosts/$name.json"
    "/usr/lib64/mozilla/native-messaging-hosts/$name.json"
    "/usr/local/lib/site-keyboard-layout/$name.py"
  )
  dirs=("/usr/local/lib/site-keyboard-layout")
else
  data="${XDG_DATA_HOME:-$HOME/.local/share}/site-keyboard-layout"
  targets=(
    "$HOME/.mozilla/native-messaging-hosts/$name.json"
    "$data/$name.py"
  )
  dirs=("$data")
fi

for f in "${targets[@]}"; do
  if [ -e "$f" ]; then
    rm -f "$f"
    echo "Removed: $f"
  fi
done
for d in "${dirs[@]}"; do
  [ -d "$d" ] && rmdir "$d" 2>/dev/null || true
done
