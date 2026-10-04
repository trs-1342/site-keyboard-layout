# SPDX-License-Identifier: GPL-3.0-only
"""Tests for the native messaging host. Run: python3 -m unittest discover tests"""
import importlib.util
import io
import json
import pathlib
import struct
import unittest

HOST = pathlib.Path(__file__).resolve().parent.parent / "native" / "site_keyboard_layout.py"
spec = importlib.util.spec_from_file_location("host", HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class FakeBackend:
    name = "fake"

    def __init__(self):
        self.index = 0
        self.calls = []

    def layouts(self):
        return [{"id": "us", "name": "English (US)"}, {"id": "tr(f)", "name": "Turkish (F)"}]

    def current_index(self):
        return self.index

    def set_index(self, index):
        self.calls.append(index)
        self.index = index


def frame(obj):
    data = json.dumps(obj).encode()
    return struct.pack("=I", len(data)) + data


class HandleTests(unittest.TestCase):
    def setUp(self):
        self.backend = FakeBackend()

    def test_status(self):
        res = host.handle({"cmd": "status"}, self.backend)
        self.assertTrue(res["ok"])
        self.assertEqual(res["current"], "us")
        self.assertEqual([l["id"] for l in res["layouts"]], ["us", "tr(f)"])

    def test_set_changes_layout(self):
        res = host.handle({"cmd": "set", "layout": "tr(f)"}, self.backend)
        self.assertEqual(res, {"ok": True, "changed": True})
        self.assertEqual(self.backend.calls, [1])

    def test_set_same_layout_is_noop(self):
        res = host.handle({"cmd": "set", "layout": "us"}, self.backend)
        self.assertEqual(res, {"ok": True, "changed": False})
        self.assertEqual(self.backend.calls, [])

    def test_unknown_layout_rejected(self):
        res = host.handle({"cmd": "set", "layout": "de"}, self.backend)
        self.assertFalse(res["ok"])
        self.assertEqual(self.backend.calls, [])

    def test_malformed_requests_rejected(self):
        bad = [
            None, [], "set", 7,
            {}, {"cmd": "run"}, {"cmd": "set"},
            {"cmd": "set", "layout": 1},
            {"cmd": "set", "layout": ["us"]},
            {"cmd": "set", "layout": "us; rm -rf ~"},
            {"cmd": "set", "layout": "--help"[:0]},
            {"cmd": "set", "layout": "a" * 100},
            {"cmd": "set", "layout": "us\n"},
        ]
        for msg in bad:
            with self.subTest(msg=msg):
                self.assertFalse(host.handle(msg, self.backend)["ok"])
        self.assertEqual(self.backend.calls, [])


class ProtocolTests(unittest.TestCase):
    def test_round_trip(self):
        self.assertEqual(host.read_message(io.BytesIO(frame({"cmd": "status"}))), {"cmd": "status"})

    def test_oversized_message_rejected(self):
        stream = io.BytesIO(struct.pack("=I", host.MAX_MESSAGE_BYTES + 1) + b"x")
        with self.assertRaises(ValueError):
            host.read_message(stream)

    def test_truncated_message(self):
        self.assertIsNone(host.read_message(io.BytesIO(b"\x01")))
        self.assertIsNone(host.read_message(io.BytesIO(struct.pack("=I", 10) + b"{}")))

    def test_write_message(self):
        out = io.BytesIO()
        host.write_message(out, {"ok": True})
        raw = out.getvalue()
        self.assertEqual(struct.unpack("=I", raw[:4])[0], len(raw) - 4)
        self.assertEqual(json.loads(raw[4:]), {"ok": True})

    def test_caller_check(self):
        self.assertTrue(host.caller_is_allowed(["host", "/path/manifest.json", host.ALLOWED_EXTENSION]))
        self.assertFalse(host.caller_is_allowed(["host"]))
        self.assertFalse(host.caller_is_allowed(["host", "/path/manifest.json", "other@example.org"]))


if __name__ == "__main__":
    unittest.main()
