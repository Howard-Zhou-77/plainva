package com.plainva.app;

import android.accounts.Account;
import android.app.Activity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;

/** Google Play services owns access-token renewal. No web client secret or
 * refresh-token exchange is embedded in the Android application. */
@CapacitorPlugin(name = "GoogleAuthorization")
public class GoogleAuthorizationPlugin extends Plugin {
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall active;

    @Override public void load() {
        launcher = getActivity().getActivityResultRegistry().register(
            "plainva.google.authorization", new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                PluginCall call = active;
                if (call == null) return;
                active = null;
                if (result.getResultCode() != Activity.RESULT_OK) { call.reject("Google authorization cancelled", "CANCELLED"); return; }
                try { finish(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData())); }
                catch (Exception ignored) { call.reject("Google authorization failed", "AUTH_FAILED"); }
            });
    }

    @PluginMethod public void authorize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (active != null) { call.reject("Google authorization is already running", "BUSY"); return; }
            try {
                JSArray values = call.getArray("scopes");
                if (values == null || values.length() == 0 || values.length() > 32) { call.reject("Invalid Google scopes"); return; }
                List<Scope> scopes = new ArrayList<>();
                for (int i = 0; i < values.length(); i++) {
                    String scope = values.getString(i);
                    if (scope.isEmpty() || scope.length() > 1024 || scope.chars().anyMatch(Character::isWhitespace)) { call.reject("Invalid Google scopes"); return; }
                    scopes.add(new Scope(scope));
                }
                boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
                String email = call.getString("email", "").trim();
                if (!interactive && email.isEmpty()) { call.reject("Google account needs sign-in", "CONSENT_REQUIRED"); return; }
                AuthorizationRequest.Builder request = AuthorizationRequest.builder().setRequestedScopes(scopes).setOptOutIncludingGrantedScopes(true);
                if (!email.isEmpty()) request.setAccount(new Account(email, "com.google"));
                else request.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
                active = call;
                Identity.getAuthorizationClient(getActivity()).authorize(request.build())
                    .addOnSuccessListener(result -> {
                        if (active != call) return;
                        if (result.hasResolution()) {
                            if (!interactive) { active = null; call.reject("Google account needs sign-in", "CONSENT_REQUIRED"); return; }
                            try { launcher.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build()); }
                            catch (Exception ignored) { active = null; call.reject("Google authorization could not open", "AUTH_FAILED"); }
                        } else { active = null; finish(call, result); }
                    }).addOnFailureListener(ignored -> { if (active == call) active = null; call.reject("Google authorization failed", "AUTH_FAILED"); });
            } catch (Exception ignored) { active = null; call.reject("Google authorization failed", "AUTH_FAILED"); }
        });
    }

    private void finish(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) { call.reject("Google authorization returned no access token", "AUTH_FAILED"); return; }
        JSObject value = new JSObject();
        value.put("accessToken", token);
        value.put("scopes", new JSArray(result.getGrantedScopes()));
        call.resolve(value);
    }

    @PluginMethod public void clearToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token.isEmpty()) { call.resolve(); return; }
        Identity.getAuthorizationClient(getActivity()).clearToken(ClearTokenRequest.builder().setToken(token).build())
            .addOnSuccessListener(ignored -> call.resolve())
            .addOnFailureListener(ignored -> call.reject("Google token cache could not be cleared", "CACHE_FAILED"));
    }

    @Override protected void handleOnDestroy() {
        if (launcher != null) launcher.unregister();
        if (active != null) { active.reject("Google authorization interrupted", "CANCELLED"); active = null; }
    }
}
