package com.tarkovoperator.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app update of the Android build from the site (owner, 13.10.2026: «добавь туда автообновление внутри приложения…
 * оно будет у нас на сайте»). src/mobile/androidUpdate.ts reads https://raidos.app/download/android/version.json
 * through fetchManifest, downloads the APK it names with download (size and SHA-256, then the package name, the version
 * and the signing certificate compared with this app) and opens Android's installer with install. Nothing is installed
 * without the player's tap, and Android itself refuses an update signed by another key.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    private static final String DIR = "updates";
    private final ExecutorService worker = Executors.newCachedThreadPool();
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    /** This build (versionCode, versionName), whether it may open the installer, whether the network is metered. */
    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo own = ownPackage(0);
            JSObject result = new JSObject();
            result.put("versionCode", versionCode(own));
            result.put("versionName", own.versionName);
            result.put("canInstall", canInstall());
            result.put("metered", metered());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("info", "info", error);
        }
    }

    /** { status: 200, body } or { status } for any other answer (404: nothing published yet). */
    @PluginMethod
    public void fetchManifest(PluginCall call) {
        String url = call.getString("url");
        worker.execute(() -> {
            JSObject result = new JSObject();
            try {
                String body = UpdateDownload.fetchText(url);
                result.put("status", 200);
                result.put("body", body);
                call.resolve(result);
            } catch (UpdateDownload.HttpStatusException error) {
                result.put("status", error.status);
                call.resolve(result);
            } catch (Exception error) {
                fail(call, error);
            }
        });
    }

    /** Downloads and checks the APK of `versionCode`; progress arrives as «downloadProgress» { received, total }. */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        long size = longArg(call, "size");
        long versionCode = longArg(call, "versionCode");
        if (versionCode <= 0) {
            call.reject("bad-release", "bad-release");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("busy", "busy");
            return;
        }
        worker.execute(() -> {
            try {
                File file = apkFile(versionCode);
                final long[] last = { 0L, -1L };
                UpdateDownload.download(url, sha256, size, file, (received, total) -> {
                    long now = System.currentTimeMillis();
                    long percent = received * 100 / total;
                    if (percent != last[1] && (now - last[0] >= 200 || received == total)) {
                        last[0] = now;
                        last[1] = percent;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total);
                        notifyListeners("downloadProgress", progress);
                    }
                });
                try {
                    verifyArchive(file, versionCode);
                } catch (Exception wrong) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                    throw wrong;
                }
                JSObject result = new JSObject();
                result.put("ready", true);
                call.resolve(result);
            } catch (Exception error) {
                fail(call, error);
            } finally {
                downloading.set(false);
            }
        });
    }

    /**
     * Opens Android's installer for the downloaded APK of `versionCode`. Without the «install unknown apps» permission
     * for Raid OS, opens that setting instead: { started: false, needsPermission: true }.
     */
    @PluginMethod
    public void install(PluginCall call) {
        long versionCode = longArg(call, "versionCode");
        File file = apkFile(versionCode);
        if (versionCode <= 0 || !file.isFile()) {
            call.reject("missing", "missing");
            return;
        }
        try {
            verifyArchive(file, versionCode);
        } catch (Exception error) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            fail(call, error);
            return;
        }
        JSObject result = new JSObject();
        if (!canInstall()) {
            openUnknownSources();
            result.put("started", false);
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
                result.put("started", true);
                call.resolve(result);
            } catch (ActivityNotFoundException error) {
                call.reject("installer", "installer");
            }
        });
    }

    /** Android's «Install unknown apps» page for Raid OS. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        openUnknownSources();
        call.resolve();
    }

    /** Deletes downloaded APKs except the one of `keepVersionCode` (none: all of them). */
    @PluginMethod
    public void cleanup(PluginCall call) {
        long keep = longArg(call, "keepVersionCode");
        File[] files = new File(getContext().getCacheDir(), DIR).listFiles();
        if (files != null) {
            for (File file : files) {
                if (keep > 0 && file.getName().equals(apkFile(keep).getName())) continue;
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
        call.resolve();
    }

    private File apkFile(long versionCode) {
        return new File(new File(getContext().getCacheDir(), DIR), "raid-os-" + versionCode + ".apk");
    }

    /** The downloaded file must be this app, the announced version, newer than this build and signed by our key. */
    private void verifyArchive(File file, long versionCode) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(file.getPath(), flags);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) throw new UpdateDownload.UpdateException("package");
        PackageInfo own = ownPackage(flags);
        if (versionCode(archive) != versionCode || versionCode <= versionCode(own)) throw new UpdateDownload.UpdateException("version");
        // Where Android names the certificates of both, one of ours must be among the APK's (its history counts:
        // a rotated key still carries the old one). Android checks the same again when it installs.
        Set<String> theirs = signers(archive);
        Set<String> ours = signers(own);
        if (!theirs.isEmpty() && !ours.isEmpty() && Collections.disjoint(theirs, ours)) throw new UpdateDownload.UpdateException("signature");
    }

    private Set<String> signers(PackageInfo info) {
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signing = info.signingInfo;
            if (signing != null) signatures = signing.hasMultipleSigners() ? signing.getApkContentsSigners() : signing.getSigningCertificateHistory();
        } else {
            signatures = info.signatures;
        }
        Set<String> digests = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) digests.add(UpdateDownload.hex(UpdateDownload.sha256().digest(signature.toByteArray())));
        return digests;
    }

    private PackageInfo ownPackage(int flags) throws PackageManager.NameNotFoundException {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), flags);
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** Unknown counts as metered: then the update waits for the player's «Скачать». */
    private boolean metered() {
        try {
            ConnectivityManager connectivity = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            return connectivity == null || connectivity.isActiveNetworkMetered();
        } catch (RuntimeException error) {
            return true;
        }
    }

    private void openUnknownSources() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
            } catch (ActivityNotFoundException ignored) {
                // a phone without that page: the installer asks for the permission itself
            }
        });
    }

    /** JSON numbers arrive as Integer or Long. */
    private static long longArg(PluginCall call, String name) {
        Object value = call.getData().opt(name);
        return value instanceof Number ? ((Number) value).longValue() : -1L;
    }

    private static void fail(PluginCall call, Exception error) {
        String code = error instanceof UpdateDownload.UpdateException ? ((UpdateDownload.UpdateException) error).code : "network";
        call.reject(code, code);
    }
}
