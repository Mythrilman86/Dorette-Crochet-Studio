package com.deescrochetstudio.app;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

public class PlayUpdates {
    public static void start(Activity activity, PluginCall call) {
        call.resolve(new JSObject().put("result", "unavailable"));
    }
}
