#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Installs the native messaging host for Site Keyboard Layout on Linux.
#
#   ./native/install.sh            pick the right mode automatically
#   ./native/install.sh --user     current user only (~/.mozilla)
#   sudo ./native/install.sh --system   all users
#
# It can also be run without downloading the project first:
#   curl -fsSL https://raw.githubusercontent.com/trs-1342/site-keyboard-layout/v2.0.2/native/install.sh | sudo bash
# In that case the helper program is fetched from the same release and its
# checksum is verified before anything is installed.
#
# Firefox looks for the host manifest in ~/.mozilla/native-messaging-hosts and
# in /usr/lib{,64}/mozilla/native-messaging-hosts. Newer Firefox profiles live
# in ~/.config/mozilla and have no ~/.mozilla at all; this script never creates
# that directory (Firefox could mistake it for a legacy profile location), so
# such systems need --system.
set -euo pipefail

name="site_keyboard_layout"
extension_id="site-keyboard-layout@trs-1342"
version="2.0.2"
helper_sha256="c322c1853945f3a5d05dc03e0806473fd954fd7fb195557182c4abb4afab277c"
base_url="https://raw.githubusercontent.com/trs-1342/site-keyboard-layout/v$version/native"
mode="${1:-auto}"

# Empty when the script is piped into bash instead of run from a checkout.
here=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/$name.py" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ "$mode" = "auto" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    mode="--system"
  elif [ -d "$HOME/.mozilla" ]; then
    mode="--user"
  else
    echo "No ~/.mozilla directory found, so a system-wide install is needed:" >&2
    echo "  sudo bash install.sh --system" >&2
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
    [ "$(id -u)" -eq 0 ] || { echo "--system needs root: sudo bash install.sh --system" >&2; exit 1; }
    lib_dir="/usr/local/lib/site-keyboard-layout"
    manifest_dirs=("/usr/lib/mozilla/native-messaging-hosts")
    # Fedora and friends use a separate lib64 tree.
    if [ -d /usr/lib64 ] && [ ! -L /usr/lib64 ]; then
      manifest_dirs+=("/usr/lib64/mozilla/native-messaging-hosts")
    fi
    ;;
  *)
    echo "Usage: install.sh [--user|--system]" >&2
    exit 1
    ;;
esac

if [ -n "$here" ]; then
  source_file="$here/$name.py"
else
  command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL "$base_url/$name.py" -o "$tmp"
  echo "$helper_sha256  $tmp" | sha256sum -c --quiet - || { echo "Checksum mismatch, nothing installed." >&2; exit 1; }
  source_file="$tmp"
fi

install -d -m 755 "$lib_dir"
install -m 755 "$source_file" "$lib_dir/$name.py"

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
