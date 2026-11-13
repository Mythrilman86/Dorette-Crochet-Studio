package com.deescrochetstudio.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(StudioFiles.class);
        registerPlugin(StudioImageImport.class);
        registerPlugin(StudioUpdates.class);
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean checking;

            @Override
            public void handleOnBackPressed() {
                if (checking) return;
                checking = true;
                bridge.getWebView().evaluateJavascript(
                    "window.StudioHandleBack?.() === true",
                    handled -> {
                        checking = false;
                        if ("true".equals(handled) || isFinishing()) return;
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                );
            }
        });
    }
}
