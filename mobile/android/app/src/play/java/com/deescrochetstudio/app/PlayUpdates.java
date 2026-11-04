package com.deescrochetstudio.app;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

public class PlayUpdates {
    public static void start(Activity activity, PluginCall call) {
        AppUpdateManager manager = AppUpdateManagerFactory.create(activity);
        manager.getAppUpdateInfo().addOnSuccessListener(info -> {
            int availability = info.updateAvailability();
            boolean eligible = availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                || (availability == UpdateAvailability.UPDATE_AVAILABLE
                    && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
            try {
                boolean started = eligible && manager.startUpdateFlowForResult(
                    info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE), 7841);
                call.resolve(new JSObject().put("result", started ? "started" : "unavailable"));
            } catch (android.content.IntentSender.SendIntentException error) {
                call.reject("Google Play could not open the update prompt", error);
            }
        }).addOnFailureListener(error -> call.reject("Google Play could not check for updates", error));
    }
}
