"""Check embedded extension/signing evidence and create the exact export map."""
import datetime
import pathlib
import plistlib
import subprocess
import sys

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
app = archive / "Products/Applications/App.app"
extension = app / "PlugIns/ShareExtension.appex"
profiles = {}
versions = []
for product, bundle_id, package_type in [(app, "com.plainva.app", "APPL"), (extension, "com.plainva.app.share", "XPC!")]:
    info = plistlib.loads((product / "Info.plist").read_bytes())
    assert info["CFBundleIdentifier"] == bundle_id, "Unexpected bundle identifier"
    assert info.get("CFBundlePackageType") == package_type, "Unexpected bundle package type"
    executable = info.get("CFBundleExecutable")
    assert isinstance(executable, str) and executable and pathlib.Path(executable).name == executable, "Missing or invalid CFBundleExecutable"
    assert (product / executable).is_file(), "Declared bundle executable is missing"
    versions.append((info["CFBundleShortVersionString"], info["CFBundleVersion"]))
    subprocess.run(["codesign", "--verify", "--strict", str(product)], check=True)
    raw = subprocess.check_output(["security", "cms", "-D", "-i", str(product / "embedded.mobileprovision")])
    profile = plistlib.loads(raw)
    entitlements = profile["Entitlements"]
    assert entitlements["application-identifier"] == "M3FGXPBLFZ." + bundle_id, "Profile does not match bundle"
    assert "group.com.plainva.app" in entitlements.get("com.apple.security.application-groups", []), "Profile lacks the shared App Group"
    assert profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), "Expired profile"
    signed = plistlib.loads(subprocess.check_output(["codesign", "-d", "--entitlements", ":-", str(product)], stderr=subprocess.DEVNULL))
    assert "group.com.plainva.app" in signed.get("com.apple.security.application-groups", []), "Signed binary lacks the App Group"
    profiles[bundle_id] = profile["UUID"]
assert versions[0] == versions[1], "App and extension versions differ"
assert len(set(profiles.values())) == 2, "App and extension need distinct matching profiles"
destination.write_bytes(plistlib.dumps({"method": "app-store-connect", "destination": "upload", "teamID": "M3FGXPBLFZ", "signingStyle": "manual", "provisioningProfiles": profiles}))
print("App and embedded ShareExtension verified; versions and separate App Group profiles match.")
