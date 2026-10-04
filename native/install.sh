#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Installs the native messaging host for Site Keyboard Layout on Linux.
#
#   ./native/install.sh            pick the right mode automatically
#   ./native/install.sh --user     current user only (~/.mozilla)
#   sudo ./native/install.sh --system   all users
#
# Firefox looks for the host manifest in ~/.mozilla/native-messaging-hosts and
# in /usr/lib{,64}/mozilla/native-messaging-hosts. Newer Firefox profiles live
# in ~/.config/mozilla and have no ~/.mozilla at all; this script never creates
# that directory (Firefox could mistake it for a legacy profile location), so
# such systems need --system.
set -euo pipefail

name="site_keyboard_layout"
extension_id="site-keyboard-layout@trs-1342"
here="$(cd "$(dirname "$0")" && pwd)"
mode="${1:-auto}"

if [ "$mode" = "auto" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    mode="--system"
  elif [ -d "$HOME/.mozilla" ]; then
    mode="--user"
  else
    echo "No ~/.mozilla directory found, so a system-wide install is needed:" >&2
    echo "  sudo $0 --system" >&2
    exit 1
  fi
fi

command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }
[ -x /usr/bin/busctl ] || [ -x /bin/busctl ] || { echo "busctl (systemd) is required." >&2; exit 1; }

case "$mode" in
  --user)
    lib_dir="${XDG_DATA_HOME:-$HOME/.local/share}/site-keyboard-layout"
    manifest_dirs=("$HOME/.mozilla/native-messaging-hosts")
    ;;
  --system)
    [ "$(id -u)" -eq 0 ] || { echo "--system needs root: sudo $0 --system" >&2; exit 1; }
    lib_dir="/usr/local/lib/site-keyboard-layout"
    manifest_dirs=("/usr/lib/mozilla/native-messaging-hosts")
    # Fedora and friends use a separate lib64 tree.
    if [ -d /usr/lib64 ] && [ ! -L /usr/lib64 ]; then
      manifest_dirs+=("/usr/lib64/mozilla/native-messaging-hosts")
    fi
    ;;
  *)
    echo "Usage: $0 [--user|--system]" >&2
    exit 1
    ;;
esac

install -d -m 755 "$lib_dir"
install -m 755 "$here/$name.py" "$lib_dir/$name.py"

for dir in "${manifest_dirs[@]}"; do
  install -d -m 755 "$dir"
  cat > "$dir/$name.json" <<JSON
{
  "name": "$name",
  "description": "Keyboard layout switcher for the Site Keyboard Layout extension",
  "path": "$lib_dir/$name.py",
  "type": "stdio",
  "allowed_extensions": ["$extension_id"]
}
JSON
  chmod 644 "$dir/$name.json"
  echo "Installed: $dir/$name.json"
done
echo "Installed: $lib_dir/$name.py"
