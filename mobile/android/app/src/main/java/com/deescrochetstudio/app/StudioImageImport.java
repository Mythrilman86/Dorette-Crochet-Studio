package com.deescrochetstudio.app;

import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "StudioImageImport")
public class StudioImageImport extends Plugin {
    private final AtomicBoolean active = new AtomicBoolean();

    @PluginMethod
    public void prepareHeif(PluginCall call) {
        if (Build.VERSION.SDK_INT < 28) { call.reject("HEIC needs a newer Android photo decoder."); return; }
        String input = call.getString("data", "");
        if (input.length() > 20 * 1024 * 1024 || input.length() < 16) { call.reject("HEIC photo exceeds the 15 MiB Android input limit."); return; }
        if (!active.compareAndSet(false, true)) { call.reject("Wait for the current photo to finish."); return; }
        new Thread(() -> {
            Bitmap bitmap = null;
            try {
                byte[] bytes = Base64.decode(input, Base64.NO_WRAP);
                if (bytes.length < 16 || bytes[4] != 'f' || bytes[5] != 't' || bytes[6] != 'y' || bytes[7] != 'p') throw new IllegalArgumentException();
                bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes)), (decoder, info, source) -> {
                    String mime = info.getMimeType();
                    int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                    if (!(mime.equals("image/heif") || mime.equals("image/heic")) || w < 1 || h < 1 || (long) w * h > 24000000L) throw new IllegalArgumentException();
                    double scale = Math.min(1, Math.min(4096.0 / Math.max(w,h), Math.sqrt(12000000.0 / ((long) w*h))));
                    decoder.setTargetSize(Math.max(1,(int)(w*scale)),Math.max(1,(int)(h*scale)));
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    decoder.setTargetColorSpace(android.graphics.ColorSpace.get(android.graphics.ColorSpace.Named.SRGB));
                });
                boolean alpha = bitmap.hasAlpha();
                try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    for (int i=0; i<5; i++) {
                        output.reset();
                        if (!bitmap.compress(alpha ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 94-i*3, output)) throw new IllegalStateException();
                        if (output.size() <= 5 * 1024 * 1024) {
                            JSObject result = new JSObject();
                            result.put("mime", alpha ? "image/png" : "image/jpeg");
                            result.put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                            call.resolve(result); return;
                        }
                        Bitmap smaller = Bitmap.createScaledBitmap(bitmap,Math.max(1,bitmap.getWidth()*4/5),Math.max(1,bitmap.getHeight()*4/5),true);
                        if (smaller != bitmap) bitmap.recycle();
                        bitmap = smaller;
                    }
                }
                call.reject("This photo could not fit the storage limit. Save a smaller JPEG copy in Gallery.");
            } catch (Exception | OutOfMemoryError error) {
                call.reject("Android could not decode this HEIC/HEIF locally. Save a smaller JPEG or PNG copy in Gallery.");
            } finally {
                if (bitmap != null) bitmap.recycle();
                active.set(false);
            }
        }, "studio-photo-import").start();
    }
}
