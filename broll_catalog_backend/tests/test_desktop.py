from dataclasses import asdict
import http.client
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_config import Settings, SettingsStore, CATALOG_COLUMNS
from app_release import RELEASES_URL, ReleaseChecker, release_status, version_tuple
import server_api


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.store = SettingsStore(self.base / 'local')
        self.root = self.base / 'library'
        self.root.mkdir()
        self.catalog = self.root / 'catalog.sqlite'
        with sqlite3.connect(self.catalog) as conn:
            conn.execute('CREATE TABLE clips (' + ','.join('"' + name + '" TEXT' for name in CATALOG_COLUMNS) + ')')
        self.raw = dict(media_root=str(self.root), catalog_path=str(self.catalog), cache_path=str(self.base / 'cache'))

    def test_first_launch_has_no_library_defaults(self):
        value = self.store.public()
        self.assertFalse(value['configured'])
        self.assertEqual(value['settings']['media_root'], '')
        self.assertEqual(value['settings']['catalog_path'], '')
        self.assertFalse(self.store.path.exists())

    def test_validation_is_read_only_and_settings_are_separate(self):
        before = self.catalog.read_bytes()
        settings, count = self.store.validate(self.raw)
        self.store.save(settings)
        self.assertEqual(self.catalog.read_bytes(), before)
        self.assertEqual(count, 0)
        self.assertEqual(self.store.load(), settings)
        self.assertNotIn('token', self.store.path.read_text())
        self.assertNotEqual(settings.library_key, Settings(media_root='other', catalog_path='other').library_key)

    def test_invalid_catalog_does_not_replace_working_configuration(self):
        settings, _ = self.store.validate(self.raw)
        self.store.save(settings)
        with self.assertRaises(ValueError):
            self.store.validate({**self.raw, 'catalog_path': str(self.root / 'missing.sqlite')})
        self.assertEqual(self.store.load(), settings)

    def test_cache_cannot_write_into_source_library(self):
        with self.assertRaises(ValueError):
            self.store.validate({**self.raw, 'cache_path': str(self.root / 'cache')})
        self.assertFalse((self.root / 'cache').exists())

    def test_corrupt_settings_return_to_setup(self):
        self.store.path.parent.mkdir(parents=True)
        self.store.path.write_text('{')
        self.assertFalse(self.store.load().configured)


class ReleaseTests(unittest.TestCase):
    def release(self, tag='v0.2.0', **extra):
        return dict(tag_name=tag, html_url=RELEASES_URL + '/tag/' + tag,
                    assets=[{'name': 'BrollVaultSetup.exe'}], **extra)

    def test_numeric_version_comparison(self):
        self.assertGreater(version_tuple('v0.10.0'), version_tuple('v0.9.0'))
        self.assertTrue(release_status(self.release())['available'])
        self.assertFalse(release_status(self.release('v0.1.0'))['available'])
        self.assertFalse(release_status(self.release('v0.0.9'))['available'])

    def test_unstable_or_draft_release_never_prompts(self):
        self.assertFalse(release_status(self.release(prerelease=True))['available'])
        self.assertFalse(release_status(self.release(draft=True))['available'])
        self.assertFalse(release_status(self.release('v1.0.0-rc.1'))['available'])

    def test_rejects_untrusted_release_urls(self):
        with self.assertRaises(ValueError):
            release_status({**self.release(), 'html_url': 'https://untrusted.example/download'})

    def test_disabled_updates_make_no_network_request(self):
        with patch('urllib.request.urlopen') as network:
            self.assertEqual(ReleaseChecker().check(False)['state'], 'disabled')
            network.assert_not_called()

    def test_missing_installer_is_explicit(self):
        self.assertFalse(release_status({**self.release(), 'assets': []})['installer_available'])


class SessionTests(unittest.TestCase):
    def test_session_bootstrap_and_cross_origin_protection(self):
        with patch.object(server_api, 'APP_SETTINGS', Settings()):
            server = server_api.create_server(0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(path, method='GET', headers=None, body=None):
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            result = response.status, dict(response.getheaders()), response.read()
            conn.close()
            return result
        self.assertEqual(request('/api/setup')[0], 401)
        self.assertEqual(request('/api/setup', 'POST', body='{}')[0], 401)
        bootstrap = request('/session/' + server.runtime_token)
        self.assertEqual(bootstrap[0], 303)
        self.assertIn('HttpOnly', bootstrap[1]['Set-Cookie'])
        cookie = bootstrap[1]['Set-Cookie'].split(';')[0]
        self.assertEqual(request('/api/setup', headers={'Cookie': cookie})[0], 200)
        self.assertEqual(request('/api/setup', headers={'Cookie': cookie, 'Origin': 'https://untrusted.example'})[0], 403)
        self.assertEqual(request('/api/setup', headers={'Cookie': cookie, 'Host': 'untrusted.example'})[0], 403)


if __name__ == '__main__':
    unittest.main()
