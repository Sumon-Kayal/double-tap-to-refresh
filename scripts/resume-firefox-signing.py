"""Resume an AMO version only after comparing every payload file. Exit 3 if absent.

API: https://mozilla.github.io/addons-server/topics/api/addons.html#version-detail
Only Mozilla's signature entries may differ from the unsigned build.
"""
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile

API = "https://addons.mozilla.org/api/v5/addons/addon/"
SIGNATURES = {"META-INF/manifest.mf", "META-INF/mozilla.sf", "META-INF/mozilla.rsa",
              "META-INF/cose.manifest", "META-INF/cose.sig"}


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != "https":
            raise ValueError("Refusing an insecure Mozilla download redirect")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        redirected.remove_header("Authorization")
        return redirected


def jwt_token():
    """Create the short-lived AMO token used for an authenticated request."""
    def encode(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=")

    now = int(time.time())
    payload = {"iss": os.environ["WEB_EXT_API_KEY"], "iat": now,
               "exp": now + 60, "jti": secrets.token_hex(16)}
    data = encode(b'{"alg":"HS256","typ":"JWT"}') + b"." + encode(json.dumps(payload).encode())
    signature = hmac.new(os.environ["WEB_EXT_API_SECRET"].encode(), data, hashlib.sha256).digest()
    return (data + b"." + encode(signature)).decode()


def request(url, *, authenticated=True):
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("Refusing an insecure Mozilla URL")
    headers = {}
    if authenticated and parsed.hostname == "addons.mozilla.org":
        headers["Authorization"] = "JWT " + jwt_token()
    with build_opener(SafeRedirect()).open(Request(url, headers=headers), timeout=60) as response:
        return response.read()


def verify_payload(data, source):
    expected = {p.relative_to(source).as_posix(): p.read_bytes()
                for p in source.rglob("*") if p.is_file()}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        by_name = {entry.filename: entry for entry in entries}
        if len(entries) != len(by_name):
            raise ValueError("Existing version contains duplicate ZIP entries")
        actual = {name: archive.read(entry) for name, entry in by_name.items()
                  if name not in SIGNATURES}
    if actual != expected:
        raise ValueError("Existing Mozilla version has different contents; bump the manifest version")


def resume(source=Path("firefox"), destination=Path("dist/firefox-signed.xpi"),
           fetch=request, sleep=time.sleep, clock=time.monotonic):
    manifest = json.loads((source / "manifest.json").read_text())
    addon = manifest["browser_specific_settings"]["gecko"]["id"]
    url = API + quote(addon, safe="") + "/versions/" + quote(manifest["version"], safe="") + "/"
    try:
        version = json.loads(fetch(url))
    except HTTPError as error:
        if error.code == 404:
            return False
        raise
    deadline = clock() + 900
    while True:
        if version.get("channel") != "unlisted" or version.get("version") != manifest["version"]:
            raise ValueError("Existing Mozilla version does not match the requested unlisted version")
        file = version.get("file") or {}
        if file.get("status") in {"disabled", "rejected"}:
            raise ValueError("Existing Mozilla version is disabled or rejected")
        # The developer API provides the uploaded file even while approval is pending.
        # Compare before polling, and again on the final signed file.
        if not file.get("url"):
            raise ValueError("Cannot verify the existing Mozilla submission: no file URL")
        data = fetch(file["url"])
        verify_payload(data, source)
        if file.get("status") == "public":
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            return True
        if clock() >= deadline:
            raise TimeoutError("Mozilla approval timeout; retry to resume this submission")
        sleep(10)
        version = json.loads(fetch(url))


if __name__ == "__main__":
    try:
        raise SystemExit(0 if resume() else 3)
    except Exception as error:
        raise SystemExit(f"Signing resume failed: {error}") from None
