package com.plainva.app;

import static org.junit.Assert.*;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run on a disposable emulator with the .tlstest APK as device owner.
 * No custom client trust manager: every request uses the production client. */
@RunWith(AndroidJUnit4.class)
public class HttpTrustTest {
    private static final HeldCertificate ca = new HeldCertificate.Builder()
        .certificateAuthority(1).commonName("Plainva disposable TLS fixture").build();

    private MockWebServer server(HeldCertificate leaf) throws IOException {
        MockWebServer server = new MockWebServer();
        server.useHttps(new HandshakeCertificates.Builder().heldCertificate(leaf, ca.certificate()).build().sslSocketFactory(), false);
        server.enqueue(new MockResponse().setBody("fixture"));
        server.start();
        WebDavHttpPlugin.allowConfiguredOrigin(server.url("/"));
        return server;
    }

    private void expectFailure(MockWebServer server, String expected) throws Exception {
        try (Response ignored = WebDavHttpPlugin.client.newCall(new Request.Builder().url(server.url("/private/path")).build()).execute()) {
            fail("Invalid TLS unexpectedly accepted");
        } catch (IOException error) {
            StringBuilder causes = new StringBuilder();
            for (Throwable cause = error; cause != null; cause = cause.getCause()) {
                causes.append(cause.getClass().getName()).append(": ").append(cause.getMessage()).append("; ");
            }
            assertEquals(causes.toString(), expected, HttpFailure.code(error));
        }
        assertNull("No HTTP request may cross invalid TLS", server.takeRequest(100, TimeUnit.MILLISECONDS));
    }

    @Test public void productionTrustMatrix() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("Use the release-like fixture APK", 0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE);
        DevicePolicyManager policy = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(context.getPackageName(), "com.plainva.app.TlsTestAdminReceiver");
        assertTrue("Fixture APK must own this disposable emulator", policy.isDeviceOwnerApp(context.getPackageName()));
        byte[] cert = ca.certificate().getEncoded();
        HeldCertificate valid = new HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").signedBy(ca).build();
        try (MockWebServer unknown = server(valid)) { expectFailure(unknown, "TLS_CERTIFICATE_UNTRUSTED"); }
        assertTrue(policy.installCaCert(admin, cert));
        try {
            // The CA-store notification must reach the platform trust manager.
            // A retry is bounded and only checks that notification, not invalid TLS.
            try (MockWebServer installed = server(valid)) {
                IOException last = null;
                for (int attempt = 0; attempt < 20; attempt++) {
                    try (Response result = WebDavHttpPlugin.client.newCall(new Request.Builder().url(installed.url("/")).build()).execute()) {
                        assertEquals(200, result.code()); assertEquals("fixture", result.body().string()); last = null; break;
                    } catch (IOException error) { last = error; Thread.sleep(100); }
                }
                if (last != null) throw last;
            }
            long now = System.currentTimeMillis();
            HeldCertificate expired = new HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").validityInterval(now - 120_000, now - 60_000).signedBy(ca).build();
            try (MockWebServer invalid = server(expired)) { expectFailure(invalid, "TLS_CERTIFICATE_EXPIRED"); }
            HeldCertificate future = new HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").validityInterval(now + 3_600_000, now + 7_200_000).signedBy(ca).build();
            try (MockWebServer invalid = server(future)) { expectFailure(invalid, "TLS_CERTIFICATE_NOT_YET_VALID"); }
            HeldCertificate wrongHost = new HeldCertificate.Builder().commonName("wrong.invalid").addSubjectAlternativeName("wrong.invalid").signedBy(ca).build();
            try (MockWebServer invalid = server(wrongHost)) { expectFailure(invalid, "TLS_HOSTNAME_MISMATCH"); }
            try (MockWebServer from = server(valid); MockWebServer blocked = new MockWebServer()) {
                blocked.start();
                // Fresh origin is deliberately NOT registered. The first server
                // had a response enqueued already, consume it before redirecting.
                try (Response ignored = WebDavHttpPlugin.client.newCall(new Request.Builder().url(from.url("/")).build()).execute()) { }
                from.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", blocked.url("/private")));
                try (Response ignored = WebDavHttpPlugin.client.newCall(new Request.Builder().url(from.url("/")).build()).execute()) { fail("Redirect accepted"); }
                catch (IOException error) { assertEquals("HTTP_ORIGIN_BLOCKED", HttpFailure.code(error)); }
                assertNull(blocked.takeRequest(100, TimeUnit.MILLISECONDS));
            }
            // Independent real system-root chain. No fixture CA can sign it.
            okhttp3.HttpUrl system = okhttp3.HttpUrl.get("https://example.com/");
            WebDavHttpPlugin.allowConfiguredOrigin(system);
            try (Response response = WebDavHttpPlugin.client.newCall(new Request.Builder().url(system).build()).execute()) {
                assertTrue(response.isSuccessful());
            }
        } finally { policy.uninstallCaCert(admin, cert); }
    }
}
