param(
    [Parameter(Mandatory = $true)][string]$Serial,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$mobilePath = Split-Path $PSScriptRoot -Parent
$sdkPath = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$adbPath = Join-Path $sdkPath 'platform-tools/adb.exe'
if (-not $Serial.StartsWith('emulator-')) { throw 'Use a disposable emulator, never a physical device.' }
$emulated = & $adbPath -s $Serial shell getprop ro.kernel.qemu
if ($LASTEXITCODE -ne 0 -or $emulated.Trim() -ne '1') { throw 'The disposable emulator is not available.' }

Push-Location (Join-Path $mobilePath 'android')
try {
    if (-not $SkipBuild) {
        & ./gradlew.bat :app:assembleTlsTest :app:assembleTlsTestAndroidTest -PtlsInstrumentation --console=plain --max-workers=2
        if ($LASTEXITCODE -ne 0) { throw 'TLS fixture build failed.' }
    }
    & $adbPath -s $Serial install -r app/build/outputs/apk/tlsTest/app-tlsTest.apk
    if ($LASTEXITCODE -ne 0) { throw 'Fixture APK installation failed.' }
    & $adbPath -s $Serial install -r app/build/outputs/apk/androidTest/tlsTest/app-tlsTest-androidTest.apk
    if ($LASTEXITCODE -ne 0) { throw 'Instrumentation APK installation failed.' }
    $owners = & $adbPath -s $Serial shell dumpsys device_policy
    if (($owners -join "`n") -notmatch 'com.plainva.app.tlstest/com.plainva.app.TlsTestAdminReceiver') {
        & $adbPath -s $Serial shell dpm set-device-owner com.plainva.app.tlstest/com.plainva.app.TlsTestAdminReceiver
        if ($LASTEXITCODE -ne 0) { throw 'Device owner setup failed. Use a fresh disposable emulator without accounts.' }
    }
    $result = & $adbPath -s $Serial shell am instrument -w -e class com.plainva.app.HttpTrustTest com.plainva.app.tlstest.test/androidx.test.runner.AndroidJUnitRunner
    $result | Write-Output
    if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -notmatch 'OK \(1 test\)') { throw 'Native TLS matrix failed.' }
} finally { Pop-Location }
