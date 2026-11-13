package com.getcapacitor.myapp;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.webkit.JavascriptInterface;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.deescrochetstudio.app.MainActivity;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONTokener;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Explicitly invoked on named disposable emulators only; never packaged in the app. */
@RunWith(AndroidJUnit4.class)
public class UpgradeContinuityTest {
    public static class ResultBridge {
        final CountDownLatch done = new CountDownLatch(1);
        volatile String result;
        @JavascriptInterface public void finish(String value) { result=value; done.countDown(); }
    }
    @Test public void seededDataSurvivesUpdate() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();
        String mode=InstrumentationRegistry.getArguments().getString("continuityMode", "");
        org.junit.Assume.assumeTrue("Explicit disposable-emulator continuityMode required", mode.equals("seed")||mode.equals("verify"));
        Context context=instrumentation.getTargetContext();
        File expected=new File(context.getFilesDir(),"rc1-upgrade-expected.json");
        String previous=mode.equals("verify")?new String(Files.readAllBytes(expected.toPath()),StandardCharsets.UTF_8):"null";
        String script;
        try(var input=instrumentation.getContext().getAssets().open("upgrade-probe.js")) { script=new String(input.readAllBytes(),StandardCharsets.UTF_8); }
        String wrapped="window.rc1AuditMode="+JSONObject.quote(mode)+";window.rc1AuditExpected="+previous+";"+script;
        ResultBridge result=new ResultBridge();
        Intent intent=new Intent().setClassName(context.getPackageName(),context.getPackageName()+".MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(intent)) {
            AtomicReference<MainActivity> target=new AtomicReference<>();
            scenario.onActivity(target::set);
            boolean ready=false;
            for(int i=0;i<120;i++) {
                String state=evaluate(target.get(),"document.readyState==='complete'&&!!document.getElementById('saveStatus')");
                if("true".equals(state)){ready=true;break;}
                Thread.sleep(100);
            }
            assertTrue("App document did not finish loading",ready);
            evaluate(target.get(),wrapped);
            JSONObject outcome=null;
            for(int i=0;i<600;i++) {
                Object value=new JSONTokener(evaluate(target.get(),"window.rc1AuditResult||null")).nextValue();
                if(value instanceof String){outcome=new JSONObject((String)value);break;}
                Thread.sleep(100);
            }
            assertNotNull("WebView continuity check timed out",outcome);
            assertFalse(outcome.optString("error"),outcome.has("error"));
            if(mode.equals("seed")) Files.write(expected.toPath(),outcome.getJSONObject("snapshot").toString().getBytes(StandardCharsets.UTF_8));
            else { assertTrue(outcome.toString(),outcome.getBoolean("preserved")); assertTrue(outcome.getBoolean("preset")); }
            android.os.Bundle status=new android.os.Bundle();status.putString("continuity",outcome.toString());instrumentation.sendStatus(0,status);
        }
    }
    private String evaluate(MainActivity activity,String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);latch.countDown();}));
        assertTrue("JavaScript callback timed out",latch.await(10,TimeUnit.SECONDS));return value.get();
    }

}
