package ru.dorokhin.seyf;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.TreeSet;

/** No vault access: the entire bridge payload is at most 64 epoch milliseconds. */
@CapacitorPlugin(name = "DocumentReminder", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class DocumentReminderPlugin extends Plugin {
    @Override @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
        } else call.resolve(status());
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) { call.resolve(status()); }

    @Override @PluginMethod
    public void checkPermissions(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void get(PluginCall call) { call.resolve(status()); }

    private JSObject status() {
        synchronized (DocumentReminderReceiver.LOCK) {
            JSObject result = new JSObject();
            result.put("notifications", Build.VERSION.SDK_INT < 33 ? "granted" : getPermissionState("notifications").toString());
            result.put("enabled", DocumentReminderReceiver.canNotify(getContext()));
            result.put("scheduled", DocumentReminderReceiver.scheduledCount(getContext()));
            return result;
        }
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSArray input = call.getArray("timestamps");
        if (input == null || input.length() > 64) {
            call.reject("Expected timestamps array with at most 64 entries");
            return;
        }
        TreeSet<Long> dates = new TreeSet<>();
        long now = System.currentTimeMillis();
        for (int i = 0; i < input.length(); i++) {
            Object value = input.opt(i);
            if (!(value instanceof Number)) {
                call.reject("Timestamps must be integer epoch milliseconds");
                return;
            }
            double number = ((Number) value).doubleValue();
            if (!Double.isFinite(number) || number != Math.floor(number) || number < 0 || number > 8640000000000000d) {
                call.reject("Invalid epoch milliseconds");
                return;
            }
            if (number > now) dates.add((long) number);
        }
        synchronized (DocumentReminderReceiver.LOCK) {
            try {
                // Never prompt implicitly. Disabled notifications also discard the old schedule.
                if (!DocumentReminderReceiver.canNotify(getContext())) dates.clear();
                DocumentReminderReceiver.replace(getContext(), dates);
                call.resolve(status());
            } catch (RuntimeException ignored) {
                // Do not expose a payload or platform exception in bridge logs.
                call.reject("Unable to update local reminders");
            }
        }
    }
}
