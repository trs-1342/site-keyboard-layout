# SPDX-License-Identifier: GPL-3.0-only
"""Checks that version numbers and the helper checksum agree across the project."""
import hashlib
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def find(path, pattern):
    return re.search(pattern, (ROOT / path).read_text(encoding="utf-8")).group(1)


class ReleaseTests(unittest.TestCase):
    def test_versions_match(self):
        version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
        self.assertEqual(find("native/site_keyboard_layout.py", r'VERSION = "([^"]+)"'), version)
        self.assertEqual(find("native/install.sh", r'\nversion="([^"]+)"'), version)
        self.assertEqual(find("native/install.ps1", r'\$version = "([^"]+)"'), version)

    def test_installers_pin_the_helper_checksum(self):
        digest = hashlib.sha256((ROOT / "native/site_keyboard_layout.py").read_bytes()).hexdigest()
        self.assertEqual(find("native/install.sh", r'helper_sha256="([0-9a-f]+)"'), digest)
        self.assertEqual(find("native/install.ps1", r'\$helperSha256 = "([0-9a-f]+)"'), digest)

    def test_extension_id_matches_everywhere(self):
        manifest = json.loads((ROOT / "extension/manifest.json").read_text())
        ext_id = manifest["browser_specific_settings"]["gecko"]["id"]
        for path in ("native/site_keyboard_layout.py", "native/install.sh", "native/install.ps1"):
            self.assertIn(ext_id, (ROOT / path).read_text(encoding="utf-8"), path)


if __name__ == "__main__":
    unittest.main()
