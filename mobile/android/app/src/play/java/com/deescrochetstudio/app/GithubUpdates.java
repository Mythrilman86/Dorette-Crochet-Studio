package com.deescrochetstudio.app;

import android.content.Context;
import android.content.Intent;
import java.io.File;
import java.io.IOException;

final class GithubUpdates {
    static final boolean SUPPORTED = false;

    static File download(Context context, String version, String sha256) throws IOException {
        throw new IOException("Use Google Play to update");
    }

    static Intent installer(Context context, File apk) {
        throw new IllegalStateException("Use Google Play to update");
    }
}
