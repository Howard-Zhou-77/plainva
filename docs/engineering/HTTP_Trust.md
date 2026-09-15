# HTTP trust and diagnostics

Android uses the platform Network Security Configuration with system and
user-installed certificate authorities. This is an application-wide trust
decision for clients using that configuration, not a per-WebDAV-host exception.
The native HTTP origin allowlist still applies on each redirect; cleartext
support remains available for origins explicitly configured by the user.

Desktop HTTP uses rustls with public and native root stores. iOS continues to
use URLSession platform trust. None of these paths disables certificate validity
or hostname checks. Native errors cross the mobile bridge as fixed codes; the
shared classifier stops automatic retries for invalid TLS and translates the
cause in setup and running-sync surfaces. URLSession does not always identify
the exact trust failure; the UI then uses the indeterminate verification message.
Diagnostics include the request method and code, never native exception text,
credentials, certificate subjects or private server paths.

## Native Android regression

`apps/mobile/scripts/test-http-trust.ps1 -Serial emulator-5560` builds and runs a
separate `.tlstest` application on a disposable emulator. Set `JAVA_HOME` to a
JDK 21 installation and `ANDROID_HOME` if the SDK is not in its usual location.
The test build inherits release settings, is not debuggable, and uses the same
network security XML and OkHttp client as production. Its device-admin receiver
exists only in the `tlsTest` source set. It installs a freshly generated CA in
the emulator's user store and removes it in a `finally` block. It never modifies
the host trust store or a real Plainva installation.

The matrix checks an unknown CA before installation, successful platform trust
after installation, expired and not-yet-valid certificates, hostname mismatch,
an unapproved redirect with no forwarded HTTP request, and a real system-root
HTTPS endpoint. The last check requires internet access. A failed native matrix
is not replaced by a passing XML or mocked JavaScript test. The JavaScript tests
separately verify bridge redaction, cancellation and retry classification.

Reference: [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config).
