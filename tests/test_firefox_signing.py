import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
import zipfile

spec = importlib.util.spec_from_file_location('signing', Path(__file__).parents[1] / 'scripts/resume-firefox-signing.py')
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'firefox'
        self.source.mkdir()
        self.manifest = {'version': '1.2.3', 'browser_specific_settings': {'gecko': {'id': 'addon@example.test'}}}
        (self.source / 'manifest.json').write_text(json.dumps(self.manifest))
        (self.source / 'code.js').write_text('example')
        self.dest = Path(self.temp.name) / 'dist/signed.xpi'
        self.payload = self.zip()
        self.calls = []

    def zip(self, changed=False):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for file in self.source.iterdir():
                archive.writestr(file.name, b'changed' if changed else file.read_bytes())
            archive.writestr('META-INF/mozilla.rsa', b'signature')
        return output.getvalue()

    def version(self, status='public'):
        return json.dumps({'version': '1.2.3', 'channel': 'unlisted',
                           'file': {'url': 'https://example.test/addon.xpi', 'status': status}}).encode()

    def fetch(self, url):
        self.calls.append(url)
        return self.payload if url.endswith('.xpi') else self.version()

    def test_signed_version_reused(self):
        self.assertTrue(signing.resume(self.source, self.dest, fetch=self.fetch))
        self.assertEqual(self.dest.read_bytes(), self.payload)
        self.assertIn('addon%40example.test/versions/1.2.3/', self.calls[0])

    def test_missing_version_preserves_new_submission_path(self):
        def absent(url):
            raise HTTPError(url, 404, 'absent', {}, None)
        self.assertFalse(signing.resume(self.source, self.dest, fetch=absent))
        self.assertFalse(self.dest.exists())

    def test_authentication_and_server_failures_do_not_submit(self):
        for status in [401, 403, 429, 500]:
            def failure(url):
                raise HTTPError(url, status, 'failure', {}, None)
            with self.assertRaises(HTTPError):
                signing.resume(self.source, self.dest, fetch=failure)

    def test_different_contents_rejected(self):
        self.payload = self.zip(changed=True)
        with self.assertRaisesRegex(ValueError, 'different contents'):
            signing.resume(self.source, self.dest, fetch=self.fetch)
        self.assertFalse(self.dest.exists())

    def test_pending_approval_is_resumed(self):
        versions = iter([self.version('unreviewed'), self.version()])
        def pending(url):
            return self.payload if url.endswith('.xpi') else next(versions)
        sleeps = []
        self.assertTrue(signing.resume(self.source, self.dest, fetch=pending, sleep=sleeps.append))
        self.assertEqual(sleeps, [10])

    def test_pending_mismatch_rejected_before_waiting(self):
        def mismatch(url):
            return self.zip(changed=True) if url.endswith('.xpi') else self.version('unreviewed')
        with self.assertRaisesRegex(ValueError, 'different contents'):
            signing.resume(self.source, self.dest, fetch=mismatch, sleep=lambda _: self.fail('must not poll'))

    def test_timeout_does_not_submit_or_write(self):
        def pending(url):
            return self.payload if url.endswith('.xpi') else self.version('unreviewed')
        ticks = iter([0, 901])
        with self.assertRaises(TimeoutError):
            signing.resume(self.source, self.dest, fetch=pending, clock=lambda: next(ticks))
        self.assertFalse(self.dest.exists())
