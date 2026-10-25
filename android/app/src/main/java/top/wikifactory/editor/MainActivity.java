package top.wikifactory.editor;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
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

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
    /** Deep link / Markdown import that arrived before the web layer was ready. */
    private String pendingDeepLink = null;
    private String pendingImportName = null;
    private String pendingImportText = null;
    private boolean webReady = false;

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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                webReady = true;
                deliverPending();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null) {
                    if (ASSET_DOMAIN.equals(uri.getHost())) {
                        return false;
                    }
                    // Site links stay in the app: open the page in the editor.
                    if (isSitePage(uri)) {
                        deliverDeepLink(uri.toString(), 0);
                        return true;
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

            /** Header network light: whether the system currently has Internet access. */
            @JavascriptInterface
            public boolean isNetworkAvailable() {
                ConnectivityManager manager =
                        (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (manager == null) return false;
                Network network = manager.getActiveNetwork();
                if (network == null) return false;
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                return capabilities != null
                        && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }
        }, "AndroidEditor");

        setContentView(webView);
        webView.loadUrl("https://" + ASSET_DOMAIN + "/index.html");
        handleIntent(getIntent());
    }

    /** `launchMode=singleTask`: new links arrive here instead of a new activity. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private static boolean isSitePage(Uri uri) {
        if (uri == null) return false;
        String host = uri.getHost();
        if (host == null) return false;
        boolean site = "wikifactory.top".equals(host) || "www.wikifactory.top".equals(host);
        if (!site) return false;
        String path = uri.getPath();
        return path != null && path.startsWith("/games");
    }

    /** Turn VIEW / EDIT intents into a deep link or an imported Markdown page. */
    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_EDIT.equals(action)) return;
        Uri data = intent.getData();
        String scheme = data.getScheme() == null ? "" : data.getScheme();

        if ("wikifactory-editor".equalsIgnoreCase(scheme) || isSitePage(data)) {
            pendingDeepLink = data.toString();
            deliverPending();
            return;
        }
        if ("content".equalsIgnoreCase(scheme) || "file".equalsIgnoreCase(scheme)) {
            String text = readText(data);
            if (text != null && !text.isEmpty()) {
                pendingImportName = data.getLastPathSegment() == null ? "imported.md" : data.getLastPathSegment();
                pendingImportText = text;
                deliverPending();
            } else {
                Toast.makeText(this, "无法读取该文件", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private String readText(Uri uri) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) return "";
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > 2 * 1024 * 1024) break;
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        } catch (Exception error) {
            return "";
        }
    }

    /** Wait for the JS bridge, then hand the pending link / text over exactly once. */
    private void deliverPending() {
        if (!webReady || webView == null) return;
        if (pendingDeepLink == null && pendingImportText == null) return;
        final String link = pendingDeepLink;
        final String name = pendingImportName;
        final String text = pendingImportText;
        if (link != null) {
            pendingDeepLink = null;
            deliverDeepLink(link, 0);
        }
        if (text != null) {
            pendingImportName = null;
            pendingImportText = null;
            deliverImport(name, text);
        }
    }

    private void deliverDeepLink(String url, int attempt) {
        if (webView == null) return;
        webView.evaluateJavascript("!!(window.__WFE__&&window.__WFE__.openDeepLink)", value -> {
            if ("true".equals(value)) {
                String js = "window.__WFE__.openDeepLink(" + JSONObject.quote(url) + ")";
                webView.evaluateJavascript(js, null);
            } else if (attempt < 12) {
                webView.postDelayed(() -> deliverDeepLink(url, attempt + 1), 300);
            }
        });
    }

    private void deliverImport(String name, String text) {
        deliverImport(name, text, 0);
    }

    private void deliverImport(String name, String text, int attempt) {
        if (webView == null) return;
        webView.evaluateJavascript("!!(window.__WFE__&&window.__WFE__.importMarkdown)", value -> {
            if ("true".equals(value)) {
                JSONObject payload = new JSONObject();
                try {
                    payload.put("name", name == null ? "" : name);
                    payload.put("text", text);
                } catch (Exception ignored) {
                    return;
                }
                webView.evaluateJavascript("window.__WFE__.importMarkdown(" + payload + ")", null);
            } else if (attempt < 12) {
                webView.postDelayed(() -> deliverImport(name, text, attempt + 1), 300);
            }
        });
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
