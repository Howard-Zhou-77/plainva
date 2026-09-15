"""Validate both distribution profiles without logging their contents."""
import datetime
import os
import pathlib
import plistlib
import subprocess
import sys

for file, bundle, variable in [(sys.argv[1], "com.plainva.app", "PLAINVA_APP_PROFILE"), (sys.argv[2], "com.plainva.app.share", "PLAINVA_SHARE_PROFILE")]:
    profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", file]))
    entitlements = profile["Entitlements"]
    assert entitlements["application-identifier"] == "M3FGXPBLFZ." + bundle, "Wrong bundle in signing profile: " + bundle
    assert "group.com.plainva.app" in entitlements.get("com.apple.security.application-groups", []), "Profile lacks group.com.plainva.app: " + bundle
    assert not entitlements.get("get-task-allow", False) and not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices", False), "An App Store distribution profile is required: " + bundle
    assert profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), "Expired signing profile: " + bundle
    identifier = profile["UUID"]
    with pathlib.Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as output:
        output.write(variable + "=" + identifier + "\n")
print("Both App Store profiles match their bundle and App Group.")
