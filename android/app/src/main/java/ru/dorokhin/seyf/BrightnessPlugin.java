package ru.dorokhin.seyf;

import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicLong;

/** Window-only override. All window state belongs to the main thread. */
@CapacitorPlugin(name = "Brightness")
public class BrightnessPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicLong revision = new AtomicLong();
    private volatile boolean resumed;
    private boolean destroyed, active, keptScreenOn;
    private float originalBrightness;
    private Window savedWindow;

    @PluginMethod
    public void maximize(PluginCall call) {
        long request = revision.incrementAndGet();
        boolean requestedWhileResumed = resumed;
        boolean keep = Boolean.TRUE.equals(call.getBoolean("keepScreenOn", false));
        main.post(() -> {
            if (request == revision.get() && requestedWhileResumed && resumed && !destroyed) {
                Window window = getActivity().getWindow();
                if (!active) {
                    savedWindow = window;
                    originalBrightness = window.getAttributes().screenBrightness;
                    keptScreenOn = (window.getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
                    active = true;
                }
                WindowManager.LayoutParams attrs = window.getAttributes();
                attrs.screenBrightness = 1f;
                window.setAttributes(attrs);
                if (keep) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve(state());
        });
    }

    @PluginMethod
    public void restore(PluginCall call) {
        long request = revision.incrementAndGet();
        main.post(() -> {
            if (request == revision.get()) restoreWindow();
            call.resolve(state());
        });
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("active", active);
        return result;
    }

    private void restoreWindow() {
        if (!active) return;
        WindowManager.LayoutParams attrs = savedWindow.getAttributes();
        attrs.screenBrightness = originalBrightness; // Includes -1 (system automatic brightness).
        savedWindow.setAttributes(attrs);
        if (keptScreenOn) savedWindow.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else savedWindow.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        active = false;
        savedWindow = null;
    }

    @Override protected void handleOnResume() { resumed = true; }
    @Override protected void handleOnPause() {
        resumed = false;
        revision.incrementAndGet(); // Invalidate work queued before pause, even after a quick resume.
        restoreWindow();
    }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        resumed = false;
        revision.incrementAndGet();
        restoreWindow();
    }
}
