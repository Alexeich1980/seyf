package ru.dorokhin.seyf;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

/** Non-exported, same-process receiver. Preferences contain dates only, never document data. */
public class DocumentReminderReceiver extends BroadcastReceiver {
    static final Object LOCK = new Object();
    private static final String ACTION = "ru.dorokhin.seyf.DOCUMENT_REMINDER";
    static final String OPEN_ACTION = "ru.dorokhin.seyf.OPEN_DOCUMENT_REMINDERS";
    private static final String CHANNEL = "document_reminders";
    private static final String TEXT = "Проверьте сроки документов в Сейфе";
    private static final int NOTIFICATION_ID = 13401;
    private static final long WINDOW_MS = 60 * 60 * 1000L;

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("document_reminder_dates", Context.MODE_PRIVATE);
    }

    private static TreeSet<Long> dates(Context context) {
        TreeSet<Long> result = new TreeSet<>();
        for (String value : prefs(context).getStringSet("timestamps", new HashSet<>())) {
            try { result.add(Long.parseLong(value)); } catch (NumberFormatException ignored) { }
        }
        return result;
    }

    static TreeSet<Long> futureDates(Context context) {
        TreeSet<Long> result = dates(context);
        result.removeIf(date -> date <= System.currentTimeMillis());
        return result;
    }

    static int scheduledCount(Context context) { return dates(context).size(); }

    private static void save(Context context, Set<Long> dates) {
        Set<String> values = new HashSet<>();
        for (Long date : dates) values.add(Long.toString(date));
        if (!prefs(context).edit().putStringSet("timestamps", values).commit()) {
            throw new IllegalStateException("Reminder storage unavailable");
        }
    }

    static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    private static PendingIntent alarmIntent(Context context, long date, int flags) {
        Intent intent = new Intent(context, DocumentReminderReceiver.class).setAction(ACTION)
            .setData(Uri.parse("seyf-reminder://local/" + date));
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancel(Context context, Set<Long> dates) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        for (long date : dates) {
            PendingIntent pending = alarmIntent(context, date, PendingIntent.FLAG_NO_CREATE);
            if (pending != null) {
                manager.cancel(pending);
                pending.cancel();
            }
        }
    }

    private static void schedule(Context context, Set<Long> dates) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        for (long date : dates) {
            manager.setWindow(AlarmManager.RTC_WAKEUP, date, WINDOW_MS,
                alarmIntent(context, date, PendingIntent.FLAG_UPDATE_CURRENT));
        }
    }

    // Caller holds LOCK, shared with sync and delivery so disable cannot race a notification.
    static void replace(Context context, Set<Long> next) {
        TreeSet<Long> previous = dates(context);
        save(context, new TreeSet<>()); // Invalidate already queued broadcasts before cancellation.
        cancel(context, previous);
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        try {
            save(context, next);
            schedule(context, next);
        } catch (RuntimeException error) {
            cancel(context, next);
            save(context, new TreeSet<>());
            throw error;
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        synchronized (LOCK) {
            try {
                if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
                    TreeSet<Long> future = futureDates(context);
                    if (!canNotify(context)) future.clear();
                    replace(context, future);
                    return;
                }
                if (!ACTION.equals(intent.getAction()) || intent.getData() == null) return;
                Uri uri = intent.getData();
                if (!"seyf-reminder".equals(uri.getScheme()) || !"local".equals(uri.getHost())) return;
                long date = Long.parseLong(uri.getLastPathSegment());
                TreeSet<Long> remaining = dates(context);
                if (date > System.currentTimeMillis() || !remaining.remove(date)) return;
                save(context, remaining); // Consume once, including when permission was revoked.
                cancel(context, java.util.Collections.singleton(date));
                if (!canNotify(context)) return;
                NotificationManager manager = context.getSystemService(NotificationManager.class);
                if (Build.VERSION.SDK_INT >= 26) {
                    manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                        "Напоминания о документах", NotificationManager.IMPORTANCE_DEFAULT));
                }
                // Preserve the warm singleTask Activity and its pending saver. JS hides the shell,
                // drains writes and locks on OPEN_ACTION; cold start uses the normal login path.
                Intent launch = new Intent(context, MainActivity.class).setAction(OPEN_ACTION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent tap = PendingIntent.getActivity(context, NOTIFICATION_ID, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification notification = new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                    .setContentTitle("Сейф").setContentText(TEXT)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(TEXT))
                    .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(true)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
                manager.notify(NOTIFICATION_ID, notification);
            } catch (RuntimeException ignored) {
                // Revocation, unavailable system service or invalid local state must not crash boot.
            }
        }
    }
}
