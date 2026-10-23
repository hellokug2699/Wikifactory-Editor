package top.wikifactory.editor;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Minimal, offline-first WebView shell.
 *
 * The editor is a static web app loaded through WebViewAssetLoader so that it
 * has a normal https origin (localStorage, fetch and CORS all behave like a
 * browser). Only api.github.com is contacted directly; there is no backend.
 */
public class MainActivity extends Activity {
    private static final String ASSET_DOMAIN = "appassets.androidplatform.net";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String SECURE_PREFS = "wfe_secure";
    private static final String SECURE_TOKEN_FIELD = "token_blob";
    private static final String KEYSTORE_ALIAS = "wfe_token_key_v1";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean hideStatusBar = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
        }
        updateSystemBars();
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_DOMAIN)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null) {
                    if (ASSET_DOMAIN.equals(uri.getHost())) {
                        return false;
                    }
                    openExternal(uri.toString());
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void openExternal(String url) {
                runOnUiThread(() -> MainActivity.this.openExternal(url));
            }

            @JavascriptInterface
            public String secureSet(String payload) {
                return saveTokenEncrypted(payload);
            }

            @JavascriptInterface
            public String secureGet() {
                return loadTokenEncrypted();
            }

            @JavascriptInterface
            public void secureClear() {
                getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .remove(SECURE_TOKEN_FIELD)
                        .apply();
            }

            @JavascriptInterface
            public void exitApp() {
                runOnUiThread(() -> {
                    finishAndRemoveTask();
                    finishAffinity();
                });
            }

            @JavascriptInterface
            public String setImmersive(String enabled) {
                final boolean hide = "true".equals(enabled);
                runOnUiThread(() -> {
                    hideStatusBar = hide;
                    applyImmersive(hide);
                });
                return "true";
            }
        }, "AndroidEditor");

        setContentView(webView);
        webView.loadUrl("https://" + ASSET_DOMAIN + "/index.html");
    }

    /** AES-GCM key lives in the Android Keystore; only ciphertext reaches the prefs file. */
    private SecretKey keystoreKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEYSTORE_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private String saveTokenEncrypted(String payload) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keystoreKey());
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            String blob = Base64.encodeToString(iv, Base64.NO_WRAP)
                    + ":"
                    + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(SECURE_TOKEN_FIELD, blob)
                    .apply();
            return "true";
        } catch (Exception error) {
            return "false";
        }
    }

    private String loadTokenEncrypted() {
        SharedPreferences prefs = getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE);
        String blob = prefs.getString(SECURE_TOKEN_FIELD, "");
        if (blob == null || blob.isEmpty()) {
            return "";
        }
        try {
            String[] parts = blob.split(":");
            if (parts.length != 2) {
                return "";
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    keystoreKey(),
                    new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception error) {
            prefs.edit().remove(SECURE_TOKEN_FIELD).apply();
            return "";
        }
    }

    private void applyImmersive(boolean hide) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                if (hide) {
                    controller.hide(WindowInsets.Type.statusBars());
                    controller.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    controller.show(WindowInsets.Type.statusBars());
                }
            }
            return;
        }
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (hide) {
            flags |= View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        } else {
            flags &= ~(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
        decor.setSystemUiVisibility(flags);
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "无法打开链接", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateSystemBars() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        Window window = getWindow();
        int background = dark ? 0xFF0B1220 : 0xFFF4F6FB;
        window.setBackgroundDrawable(new ColorDrawable(background));
        window.setStatusBarColor(background);
        window.setNavigationBarColor(background);

        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (dark) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        } else {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (dark) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            } else {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        }
        decor.setSystemUiVisibility(flags);
        applyImmersive(hideStatusBar);
        if (webView != null) {
            webView.setBackgroundColor(background);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        updateSystemBars();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) {
                return;
            }
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // Let the web layer ask about unsaved changes before finishing the activity.
        webView.evaluateJavascript(
                "window.__WFE__ && window.__WFE__.requestExit ? (window.__WFE__.requestExit(), 'handled') : 'noop'",
                value -> {
                    if (!"\"handled\"".equals(value)) {
                        finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
