package com.deescrochetstudio.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "StudioFiles")
public class StudioFiles extends Plugin {
    private File pendingExport;

    @PluginMethod
    public void begin(PluginCall call) {
        if (pendingExport != null) {
            call.reject("Another export is in progress.");
            return;
        }
        try {
            pendingExport = File.createTempFile("studio-export-", ".tmp", getContext().getCacheDir());
            call.resolve();
        } catch (IOException error) {
            call.reject("Could not prepare the export.", error);
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        if (pendingExport == null) {
            call.reject("Export session expired.");
            return;
        }
        try (FileOutputStream output = new FileOutputStream(pendingExport, true)) {
            output.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (IOException | IllegalArgumentException error) {
            clearExport();
            call.reject("Could not prepare the export.", error);
        }
    }

    @PluginMethod
    public void discard(PluginCall call) {
        clearExport();
        call.resolve();
    }

    @PluginMethod
    public void save(PluginCall call) {
        if (pendingExport == null) {
            call.reject("Export session expired.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mime", "application/octet-stream"))
            .putExtra(Intent.EXTRA_TITLE, call.getString("name", "Studio export"));
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "saveResult");
            } catch (RuntimeException error) {
                getBridge().execute(() -> {
                    clearExport();
                    call.reject("Could not open the Android file picker.", error);
                });
            }
        });
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            clearExport();
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null
                || result.getData().getData() == null) {
            clearExport();
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        getBridge().execute(() -> {
            try (InputStream input = new FileInputStream(pendingExport);
                 OutputStream output = getContext().getContentResolver()
                     .openOutputStream(result.getData().getData(), "wt")) {
                if (output == null) throw new IOException("Destination unavailable.");
                copy(input, output);
            } catch (IOException | RuntimeException error) {
                call.reject("Could not write the selected file.", error);
                return;
            } finally {
                clearExport();
            }
            call.resolve(new JSObject().put("saved", true));
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        String name = call.getString("name", "");
        if (pendingExport == null || !name.matches("[A-Za-z0-9_-]{1,90}\\.zip")) {
            call.reject("No valid ZIP is available to share.");
            return;
        }
        File root = new File(getContext().getCacheDir(), "studio-shares");
        File[] previous = root.listFiles();
        if (previous != null) {
            long cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
            for (File folder : previous) {
                File[] files = folder.listFiles();
                if (files == null || folder.lastModified() >= cutoff) continue;
                for (File file : files) file.delete();
                folder.delete();
            }
        }
        File folder = new File(root, UUID.randomUUID().toString());
        File shared = new File(folder, name);
        if (!folder.mkdirs() || !pendingExport.renameTo(shared)) {
            folder.delete();
            call.reject("Could not prepare the ZIP for sharing.");
            return;
        }
        pendingExport = null;
        getActivity().runOnUiThread(() -> {
            try {
                android.net.Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", shared);
                Intent intent = new Intent(Intent.ACTION_SEND).setType("application/zip")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri(name, uri));
                getActivity().startActivity(Intent.createChooser(intent, "Share crochet project"));
                call.resolve(new JSObject().put("saved", true));
            } catch (RuntimeException error) {
                shared.delete();
                folder.delete();
                call.reject("Could not open Android sharing.", error);
            }
        });
    }

    @PluginMethod
    public void openGuide(PluginCall call) {
        String name = "Dorette-Crochet-Studio-User-Guide.pdf";
        File folder = new File(getContext().getCacheDir(), "guide");
        File guide = new File(folder, name);
        try {
            if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("Guide folder unavailable.");
            try (InputStream input = getContext().getAssets().open("public/" + name);
                 OutputStream output = new FileOutputStream(guide)) {
                copy(input, output);
            }
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", guide), "application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (IOException | RuntimeException error) {
            call.reject("Could not open the guide in a PDF viewer.", error);
        }
    }

    private void clearExport() {
        if (pendingExport != null) {
            pendingExport.delete();
            pendingExport = null;
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
    }
}
