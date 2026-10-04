#!/usr/bin/python3 -I
# SPDX-License-Identifier: GPL-3.0-only
"""Native messaging host for the Site Keyboard Layout Firefox extension.

Firefox starts this program once per request. It reads one length-prefixed
JSON message from stdin, switches (or reports) the system keyboard layout and
writes one length-prefixed JSON reply to stdout.

Requests:
  {"cmd": "status"}               -> {"ok": true, "version", "backend", "layouts": [{id, name}], "current"}
  {"cmd": "set", "layout": "tr"}  -> {"ok": true, "changed": bool}

It keeps no state: nothing is written to disk, nothing is logged, and no
network connection is made.
"""
import json
import os
import re
import struct
import subprocess
import sys

VERSION = "2.0.1"
ALLOWED_EXTENSION = "site-keyboard-layout@trs-1342"
MAX_MESSAGE_BYTES = 4096
LAYOUT_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}(\([A-Za-z0-9_-]{1,32}\))?$")


class BackendError(Exception):
    pass


class KdeBackend:
    """KDE Plasma, through the org.kde.keyboard D-Bus service."""

    name = "kde"
    BUSCTL_CANDIDATES = ("/usr/bin/busctl", "/bin/busctl")

    def __init__(self):
        self.busctl = next((p for p in self.BUSCTL_CANDIDATES if os.access(p, os.X_OK)), None)
        if not self.busctl:
            raise BackendError("busctl not found")
        # Pass on only what is needed to reach the session bus.
        self.env = {k: os.environ[k] for k in ("DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR") if k in os.environ}
        self.env["LC_ALL"] = "C"

    def _call(self, method, *args):
        try:
            out = subprocess.run(
                [self.busctl, "--user", "--json=short", "call",
                 "org.kde.keyboard", "/Layouts", "org.kde.KeyboardLayouts", method, *args],
                capture_output=True, text=True, timeout=3, env=self.env,
            )
        except subprocess.TimeoutExpired:
            raise BackendError("D-Bus call timed out") from None
        if out.returncode != 0:
            raise BackendError("KDE keyboard service not available: " + out.stderr.strip()[:200])
        return json.loads(out.stdout)["data"] if out.stdout.strip() else None

    def layouts(self):
        result = []
        for code, variant, name in self._call("getLayoutsList")[0]:
            result.append({"id": f"{code}({variant})" if variant else code, "name": name})
        return result

    def current_index(self):
        return self._call("getLayout")[0]

    def set_index(self, index):
        self._call("setLayout", "u", str(index))


class WindowsBackend:
    """Windows, by asking the foreground window to change its input language."""

    name = "windows"
    WM_INPUTLANGCHANGEREQUEST = 0x0050
    LOCALE_SLOCALIZEDDISPLAYNAME = 0x00000002

    def __init__(self):
        import ctypes
        from ctypes import wintypes

        self.ctypes = ctypes
        u = self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        k = self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        u.GetKeyboardLayoutList.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
        u.GetKeyboardLayoutList.restype = ctypes.c_int
        u.GetKeyboardLayout.argtypes = [wintypes.DWORD]
        u.GetKeyboardLayout.restype = ctypes.c_void_p
        u.GetForegroundWindow.restype = wintypes.HWND
        u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        u.GetWindowThreadProcessId.restype = wintypes.DWORD
        u.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        u.PostMessageW.restype = wintypes.BOOL
        k.LCIDToLocaleName.argtypes = [wintypes.DWORD, wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD]
        k.LCIDToLocaleName.restype = ctypes.c_int
        k.GetLocaleInfoEx.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.LPWSTR, ctypes.c_int]
        k.GetLocaleInfoEx.restype = ctypes.c_int

    def _handles(self):
        count = self.user32.GetKeyboardLayoutList(0, None)
        array = (self.ctypes.c_void_p * count)()
        self.user32.GetKeyboardLayoutList(count, array)
        return [h or 0 for h in array]

    def _describe(self, hkl):
        buf = self.ctypes.create_unicode_buffer(128)
        if not self.kernel32.LCIDToLocaleName(hkl & 0xFFFF, buf, len(buf), 0):
            code = f"{hkl & 0xFFFF:04x}"
            return code, code
        locale = buf.value
        name = self.ctypes.create_unicode_buffer(256)
        if self.kernel32.GetLocaleInfoEx(locale, self.LOCALE_SLOCALIZEDDISPLAYNAME, name, len(name)):
            return locale, name.value
        return locale, locale

    def layouts(self):
        result, seen = [], set()
        for hkl in self._handles():
            locale, name = self._describe(hkl)
            # Two keyboards for one language get the handle appended to stay unique.
            layout_id = locale if locale not in seen else f"{locale}({hkl & 0xFFFFFFFF:08x})"
            seen.add(locale)
            result.append({"id": layout_id, "name": name})
        return result

    def _foreground(self):
        hwnd = self.user32.GetForegroundWindow()
        if not hwnd:
            raise BackendError("no foreground window")
        return hwnd

    def current_index(self):
        thread = self.user32.GetWindowThreadProcessId(self._foreground(), None)
        hkl = self.user32.GetKeyboardLayout(thread) or 0
        handles = self._handles()
        return handles.index(hkl) if hkl in handles else -1

    def set_index(self, index):
        hkl = self._handles()[index]
        if hkl >= 1 << 63:  # LPARAM is signed
            hkl -= 1 << 64
        if not self.user32.PostMessageW(self._foreground(), self.WM_INPUTLANGCHANGEREQUEST, 0, hkl):
            raise BackendError("could not post the layout change request")


def make_backend():
    if sys.platform == "win32":
        return WindowsBackend()
    if sys.platform.startswith("linux"):
        return KdeBackend()
    raise BackendError(f"unsupported platform: {sys.platform}")


def handle(msg, backend):
    if not isinstance(msg, dict):
        return {"ok": False, "error": "invalid request"}
    cmd = msg.get("cmd")

    if cmd == "status":
        layouts = backend.layouts()
        index = backend.current_index()
        current = layouts[index]["id"] if 0 <= index < len(layouts) else ""
        return {"ok": True, "version": VERSION, "backend": backend.name, "layouts": layouts, "current": current}

    if cmd == "set":
        wanted = msg.get("layout")
        if not isinstance(wanted, str) or not LAYOUT_RE.match(wanted):
            return {"ok": False, "error": "invalid layout"}
        ids = [l["id"] for l in backend.layouts()]
        if wanted not in ids:
            return {"ok": False, "error": "layout not configured on this system"}
        index = ids.index(wanted)
        if index == backend.current_index():
            return {"ok": True, "changed": False}
        backend.set_index(index)
        return {"ok": True, "changed": True}

    return {"ok": False, "error": "unknown command"}


def read_message(stream):
    header = stream.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("=I", header)
    if length > MAX_MESSAGE_BYTES:
        raise ValueError("message too large")
    body = stream.read(length)
    if len(body) < length:
        return None
    return json.loads(body)


def write_message(stream, obj):
    data = json.dumps(obj).encode()
    stream.write(struct.pack("=I", len(data)) + data)
    stream.flush()


def caller_is_allowed(argv):
    # Firefox passes the manifest path and the calling extension's ID.
    return ALLOWED_EXTENSION in argv[1:]


def main():
    out = sys.stdout.buffer
    if not caller_is_allowed(sys.argv):
        write_message(out, {"ok": False, "error": "caller not allowed"})
        return 1
    try:
        msg = read_message(sys.stdin.buffer)
        if msg is None:
            return 0
        write_message(out, handle(msg, make_backend()))
    except BackendError as e:
        write_message(out, {"ok": False, "error": str(e)})
    except Exception as e:  # never leak a traceback into the protocol stream
        write_message(out, {"ok": False, "error": type(e).__name__})
    return 0


if __name__ == "__main__":
    sys.exit(main())
