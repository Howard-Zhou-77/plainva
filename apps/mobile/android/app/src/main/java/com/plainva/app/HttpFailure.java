package com.plainva.app;

import java.net.SocketTimeoutException;
import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateNotYetValidException;
import java.security.cert.CertPathValidatorException;
import java.security.cert.PKIXReason;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

/** Stable bridge codes, with no URL, credentials or provider exception text. */
final class HttpFailure {
    private HttpFailure() {}

    static String code(Throwable error) {
        // Certificate dates are usually nested inside a handshake exception.
        Throwable cause = error;
        for (int depth = 0; cause != null && depth < 16; depth++, cause = cause.getCause()) {
            if (cause instanceof CertificateExpiredException) return "TLS_CERTIFICATE_EXPIRED";
            if (cause instanceof CertificateNotYetValidException) return "TLS_CERTIFICATE_NOT_YET_VALID";
            if (cause instanceof CertPathValidatorException) {
                CertPathValidatorException.Reason reason = ((CertPathValidatorException) cause).getReason();
                if (reason == CertPathValidatorException.BasicReason.EXPIRED) return "TLS_CERTIFICATE_EXPIRED";
                if (reason == CertPathValidatorException.BasicReason.NOT_YET_VALID) return "TLS_CERTIFICATE_NOT_YET_VALID";
                // Conscrypt can reject an expired candidate before choosing its
                // trust anchor, then report only "anchor not found". The rejected
                // CertPath still carries its dates. Inspect those for the error
                // message only; the platform's rejection is never overridden.
                java.security.cert.CertPath path = ((CertPathValidatorException) cause).getCertPath();
                if (path != null) {
                    for (java.security.cert.Certificate certificate : path.getCertificates()) {
                        if (certificate instanceof X509Certificate) {
                            try { ((X509Certificate) certificate).checkValidity(); }
                            catch (CertificateExpiredException expired) { return "TLS_CERTIFICATE_EXPIRED"; }
                            catch (CertificateNotYetValidException future) { return "TLS_CERTIFICATE_NOT_YET_VALID"; }
                        }
                    }
                }
            }
        }
        cause = error;
        for (int depth = 0; cause != null && depth < 16; depth++, cause = cause.getCause()) {
            if (cause instanceof SSLPeerUnverifiedException) return "TLS_HOSTNAME_MISMATCH";
            if (cause instanceof CertPathValidatorException &&
                (((CertPathValidatorException) cause).getReason() == PKIXReason.NO_TRUST_ANCHOR ||
                 String.valueOf(cause.getMessage()).startsWith("Trust anchor for certification path not found"))) return "TLS_CERTIFICATE_UNTRUSTED";
            if (cause instanceof SocketTimeoutException) return "HTTP_TIMEOUT";
            if ("blocked by origin policy".equals(cause.getMessage())) return "HTTP_ORIGIN_BLOCKED";
        }
        return error instanceof SSLHandshakeException ? "TLS_HANDSHAKE_FAILED" : "HTTP_NETWORK_ERROR";
    }
}
