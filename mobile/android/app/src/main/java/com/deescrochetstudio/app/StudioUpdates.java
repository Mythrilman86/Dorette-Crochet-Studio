package com.deescrochetstudio.app;

import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "StudioUpdates")
public class StudioUpdates extends Plugin {
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
        call.resolve(new JSObject().put("installedByPlay", installedByPlay()));
    }

    @PluginMethod
    public void check(PluginCall call) {
        if (!installedByPlay()) {
            call.resolve(new JSObject().put("result", "unavailable"));
            return;
        }
        getActivity().runOnUiThread(() -> PlayUpdates.start(getActivity(), call));
    }
}
