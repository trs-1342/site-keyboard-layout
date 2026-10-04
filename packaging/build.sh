#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Builds the helper program installers into dist/:
#   site-keyboard-layout-helper.rpm   Fedora, openSUSE, ...
#   site-keyboard-layout-helper.deb   Debian, Ubuntu, ...
#   site-keyboard-layout-setup.cmd    Windows
# The packages let people install the helper by opening a downloaded file
# (the system asks for the administrator password) instead of using a terminal.
# Needs: rpmbuild, ar, tar.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
name="site_keyboard_layout"
pkg="site-keyboard-layout-helper"
extension_id="site-keyboard-layout@trs-1342"
version="$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$root/native/$name.py")"
summary="Keyboard layout switcher for the Site Keyboard Layout Firefox extension"
url="https://github.com/trs-1342/site-keyboard-layout"
dist="$root/dist"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rm -rf "$dist"
mkdir -p "$dist"

# Files as they will sit on the target system.
stage() { # stage <dir> <manifest-dir>...
  local dest="$1"; shift
  install -D -m 755 "$root/native/$name.py" "$dest/usr/lib/site-keyboard-layout/$name.py"
  for dir in "$@"; do
    install -d -m 755 "$dest$dir"
    cat > "$dest$dir/$name.json" <<JSON
{
  "name": "$name",
  "description": "$summary",
  "path": "/usr/lib/site-keyboard-layout/$name.py",
  "type": "stdio",
  "allowed_extensions": ["$extension_id"]
}
JSON
    chmod 644 "$dest$dir/$name.json"
  done
}

# --- rpm ---
stage "$work/rpmroot" /usr/lib/mozilla/native-messaging-hosts /usr/lib64/mozilla/native-messaging-hosts
cat > "$work/$pkg.spec" <<SPEC
Name:           $pkg
Version:        $version
Release:        1
Summary:        $summary
License:        GPL-3.0-only
URL:            $url
BuildArch:      noarch
Requires:       python3
Requires:       systemd

%description
Small helper program that the Site Keyboard Layout Firefox extension starts
through native messaging to switch the KDE Plasma keyboard layout.

%install
cp -a $work/rpmroot/. %{buildroot}/

%files
/usr/lib/site-keyboard-layout
/usr/lib/mozilla/native-messaging-hosts/$name.json
/usr/lib64/mozilla/native-messaging-hosts/$name.json
SPEC
rpmbuild -bb --quiet --define "_topdir $work/rpmbuild" --define "_build_id_links none" "$work/$pkg.spec"
cp "$work"/rpmbuild/RPMS/noarch/*.rpm "$dist/$pkg.rpm"

# --- deb (a .deb is an ar archive of three members, no dpkg needed) ---
stage "$work/debroot" /usr/lib/mozilla/native-messaging-hosts
mkdir -p "$work/debctl"
cat > "$work/debctl/control" <<CTL
Package: $pkg
Version: $version
Section: utils
Priority: optional
Architecture: all
Depends: python3, systemd
Maintainer: trs-1342 <189001058+trs-1342@users.noreply.github.com>
Homepage: $url
Description: $summary
 Small helper program that the Site Keyboard Layout Firefox extension starts
 through native messaging to switch the KDE Plasma keyboard layout.
CTL
tar_opts=(--owner=0 --group=0 --numeric-owner)
tar "${tar_opts[@]}" -C "$work/debctl" -czf "$work/control.tar.gz" ./control
tar "${tar_opts[@]}" -C "$work/debroot" -czf "$work/data.tar.gz" .
echo "2.0" > "$work/debian-binary"
(cd "$work" && ar rc "$dist/$pkg.deb" debian-binary control.tar.gz data.tar.gz)

# --- Windows: a file to double-click, which runs the PowerShell installer ---
printf '%s\r\n' \
  '@echo off' \
  'echo Installing the Site Keyboard Layout helper program...' \
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm https://raw.githubusercontent.com/trs-1342/site-keyboard-layout/v$version/native/install.ps1 | iex\"" \
  'echo.' \
  'pause' > "$dist/site-keyboard-layout-setup.cmd"

ls -l "$dist"
