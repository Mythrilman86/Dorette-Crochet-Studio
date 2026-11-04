package com.deescrochetstudio.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import javax.net.ssl.HttpsURLConnection;

final class GithubUpdates {
    static final boolean SUPPORTED = true;
    private static final String RELEASES = "https://github.com/Mythrilman86/Dorette-Crochet-Studio/releases/download/";
    private static final long MAX_BYTES = 64 * 1024 * 1024;

    static File download(Context context, String version, String sha256) throws Exception {
        if (version == null || !version.matches("[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}")
                || sha256 == null || !sha256.matches("[0-9a-f]{64}")) {
            throw new IOException("Invalid release metadata");
        }
        URI url = URI.create(RELEASES + "v" + version + "/Dees-Crochet-Studio-" + version + "-Android.apk");
        File dir = new File(context.getCacheDir(), "studio-updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not open the update cache");
        File apk = File.createTempFile("update-", ".apk", dir);
        boolean verified = false;
        try {
            transfer(url, apk, sha256);
            verifyArchive(context, apk, version);
            verified = true;
            return apk;
        } finally {
            if (!verified) apk.delete();
        }
    }

    private static void transfer(URI url, File apk, String sha256) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 120_000;
        for (int redirects = 0; redirects <= 4; redirects++) {
            HttpsURLConnection connection = (HttpsURLConnection) url.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            try {
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException("Missing release redirect");
                    url = url.resolve(location);
                    String host = url.getHost();
                    if (!"https".equalsIgnoreCase(url.getScheme()) || url.getUserInfo() != null
                            || (url.getPort() != -1 && url.getPort() != 443)
                            || !("release-assets.githubusercontent.com".equalsIgnoreCase(host)
                                || "objects.githubusercontent.com".equalsIgnoreCase(host))) {
                        throw new IOException("Unexpected release download server");
                    }
                    continue;
                }
                if (status != 200 || connection.getContentLengthLong() > MAX_BYTES) {
                    throw new IOException("APK download unavailable");
                }
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[32768];
                    long bytes = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        bytes += count;
                        if (bytes > MAX_BYTES || SystemClock.elapsedRealtime() > deadline) {
                            throw new IOException("APK download exceeded its limit");
                        }
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                    }
                }
                byte[] expected = new byte[32];
                for (int i = 0; i < expected.length; i++) {
                    expected[i] = (byte) Integer.parseInt(sha256.substring(i * 2, i * 2 + 2), 16);
                }
                if (!MessageDigest.isEqual(expected, digest.digest())) throw new IOException("APK checksum did not match");
                return;
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException("Too many release redirects");
    }

    private static void verifyArchive(Context context, File apk, String version) throws Exception {
        PackageManager packages = context.getPackageManager();
        int flag = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = packages.getPackageInfo(context.getPackageName(), flag);
        PackageInfo candidate = packages.getPackageArchiveInfo(apk.getAbsolutePath(), flag);
        if (candidate == null || !installed.packageName.equals(candidate.packageName)
                || !version.equals(candidate.versionName) || versionCode(candidate) <= versionCode(installed)
                || !sameSigners(installed, candidate)) {
            throw new IOException("APK package, version or signing certificate did not match");
        }
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static boolean sameSigners(PackageInfo installed, PackageInfo candidate) {
        Signature[] current = signers(installed);
        Signature[] next = signers(candidate);
        return current != null && current.length > 0 && next != null
            && new HashSet<>(Arrays.asList(current)).equals(new HashSet<>(Arrays.asList(next)));
    }

    private static Signature[] signers(PackageInfo info) {
        if (Build.VERSION.SDK_INT < 28) return info.signatures;
        return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
    }

    static Intent installer(Context context, File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            return new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
        }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        return new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
}
