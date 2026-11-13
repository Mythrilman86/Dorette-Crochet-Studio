package com.getcapacitor.myapp;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void useAppContext() throws Exception {
        // Context of the app under test.
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        // Gradle writes the configured application ID into the test manifest.
        // Reading targetPackage avoids the stale Capacitor template identity.
        android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        android.content.pm.InstrumentationInfo info = instrumentation.getContext()
            .getPackageManager().getInstrumentationInfo(instrumentation.getComponentName(), 0);
        assertEquals(info.targetPackage, appContext.getPackageName());
    }
}
