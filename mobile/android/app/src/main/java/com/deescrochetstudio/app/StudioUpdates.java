package com.deescrochetstudio.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "StudioUpdates")
public class StudioUpdates extends Plugin {
    private final AtomicBoolean downloading = new AtomicBoolean();
    private volatile File verifiedApk;

    private boolean installedByPlay() {
        PackageManager packages = getContext().getPackageManager();
        String name = getContext().getPackageName();
        try {
            String installer = Build.VERSION.SDK_INT >= 30
                ? packages.getInstallSourceInfo(name).getInstallingPackageName()
                : packages.getInstallerPackageName(name);
            return "com.android.vending".equals(installer);
        } catch (PackageManager.NameNotFoundException | SecurityException ignored) {
            return false;
        }
    }

    @PluginMethod
    public void source(PluginCall call) {
        call.resolve(new JSObject().put("installedByPlay", installedByPlay()).put("githubSupported", GithubUpdates.SUPPORTED));
    }

    @PluginMethod
    public void check(PluginCall call) {
        if (!installedByPlay()) {
            call.resolve(new JSObject().put("result", "unavailable"));
            return;
        }
        getActivity().runOnUiThread(() -> PlayUpdates.start(getActivity(), call));
    }

    @PluginMethod
    public void availability(PluginCall call) {
        if (!installedByPlay()) {
            call.resolve(new JSObject().put("available", false));
            return;
        }
        getActivity().runOnUiThread(() -> PlayUpdates.availability(getActivity(), call));
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!GithubUpdates.SUPPORTED || installedByPlay() || !downloading.compareAndSet(false, true)) {
            call.reject("APK download unavailable");
            return;
        }
        new Thread(() -> {
            try {
                File apk = GithubUpdates.download(getContext(), call.getString("version"), call.getString("sha256"));
                File previous = verifiedApk;
                verifiedApk = apk;
                if (previous != null) previous.delete();
            } catch (Exception error) {
                call.reject("Could not download and verify the APK", error);
                return;
            } finally {
                downloading.set(false);
            }
            call.resolve();
        }, "Studio APK download").start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        File apk = verifiedApk;
        if (!GithubUpdates.SUPPORTED || installedByPlay() || downloading.get() || apk == null || !apk.isFile()) {
            call.reject("Download and verify the update first");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = GithubUpdates.installer(getContext(), apk);
                getActivity().startActivity(intent);
                call.resolve(new JSObject().put("permissionRequired",
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES.equals(intent.getAction())));
            } catch (RuntimeException error) {
                call.reject("Android could not open the installer", error);
            }
        });
    }
}