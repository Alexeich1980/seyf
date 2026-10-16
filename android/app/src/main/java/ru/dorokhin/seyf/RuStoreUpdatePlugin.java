package ru.dorokhin.seyf;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import ru.rustore.sdk.appupdate.manager.RuStoreAppUpdateManager;
import ru.rustore.sdk.appupdate.manager.factory.RuStoreAppUpdateManagerFactory;
import ru.rustore.sdk.appupdate.model.AppUpdateInfo;
import ru.rustore.sdk.appupdate.model.AppUpdateOptions;
import ru.rustore.sdk.appupdate.model.AppUpdateType;
import ru.rustore.sdk.appupdate.model.UpdateAvailability;
import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;

/**
 * RuStoreUpdate - мост к RuStore App Update SDK (ru.rustore.sdk:appupdate из BOM 2026.08.01,
 * javap-проверен по AAR 10.5.1). Стор-сборка «Сейфа» (1.3.2) обновляется ТОЛЬКО через RuStore:
 * своего сервера обновлений нет, приложение само в сеть не ходит. SDK спрашивает у
 * установленного на телефоне приложения RuStore, есть ли в магазине версия новее.
 *
 * checkUpdate зовёт только стор-сборка (www/update.js isStore -> www/storeupdate.js); openStore - любая
 * (кнопка «Открыть RuStore» в окне «Обновление»).
 *
 * JS-контракт (www/storeupdate.js; образец - «Карта года», проверено вживую 15.10.2026):
 *   RuStoreUpdate.checkUpdate()
 *     → {ok:true, available:boolean, versionCode:number, currentVersionCode:number}
 *     | {ok:false, reason, error?:'…'}      (никогда не reject)
 *     reason (ревью 07.10, I-2: различать причины, а не «проверьте интернет» на всё):
 *       'no-rustore'   RuStore не установлен (нет пакета ru.vk.store или RuStoreNotInstalledException)
 *       'outdated'     RuStore устарел (RuStoreOutdatedException)
 *       'unauthorized' не вошли в аккаунт RuStore (RuStoreUserUnauthorizedException)
 *       'user-banned'  аккаунт RuStore ограничен (RuStoreUserBannedException)
 *       'app-banned'   приложение недоступно в RuStore (RuStoreApplicationBannedException)
 *       'timeout'      RuStore не ответил (RuStoreConnectionTimeout)
 *       'old-android'  Android 6: SDK обновлений требует Android 7.0+, SDK не зовём вообще (ревью M-2)
 *       'sdk'          прочее (RuStoreException, сбой связи и т.п.)
 *   RuStoreUpdate.startUpdate() → {ok:true, via:'sdk'|'store'|'web', code?, reason?} | {ok:false}
 *     Окно обновления RuStore (IMMEDIATE) - только если обновление есть И isUpdateTypeAllowed(IMMEDIATE)
 *     (ревью M-1). Все остальные исходы - карточка приложения в RuStore (deeplink), без RuStore - страница
 *     в браузере: код 0 (по доке SDK это «отмена ИЛИ ошибка», ревью I-1), ACTIVITY_NOT_FOUND, неизвестный
 *     код, ошибка SDK, IMMEDIATE не разрешён, Android 6. Тишины нет: при -1 (RESULT_OK) RuStore ставит
 *     версию и закрывает приложение, во всём прочем человек оказывается в карточке RuStore с кнопкой
 *     «Обновить». {ok:false} - не открылось ничего, JS открывает страницу сам.
 *   RuStoreUpdate.openStore()    → {ok:true, via:'store'|'web'} | {ok:false}
 */
@CapacitorPlugin(name = "RuStoreUpdate")
public class RuStoreUpdatePlugin extends Plugin {

    static final String RUSTORE_PKG = "ru.vk.store";
    static final String STORE_DEEPLINK = "rustore://apps.rustore.ru/app/";
    static final String STORE_WEB = "https://www.rustore.ru/catalog/app/";
    /** SDK обновлений RuStore работает с Android 7.0 (API 24); у приложения minSdk 23 (ревью M-2) */
    static final int MIN_SDK_UPDATES = 24;

    private RuStoreAppUpdateManager manager;

    private RuStoreAppUpdateManager manager() {
        if (manager == null) manager = RuStoreAppUpdateManagerFactory.INSTANCE.create(getContext().getApplicationContext());
        return manager;
    }

    private static boolean sdkSupported() { return Build.VERSION.SDK_INT >= MIN_SDK_UPDATES; }

    private boolean ruStoreInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(RUSTORE_PKG, 0);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private long currentVersionCode() {
        try {
            Context c = getContext();
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** причина по классу исключения SDK 10.5.1 (ru.rustore.sdk.core.exception.*, javap core-10.5.0 /
     *  appupdate errors.RemoteProviderErrors: 1001 → Unauthorized, 1004 → UserBanned, 1005 → ApplicationBanned) */
    static String reasonOf(Throwable e) {
        if (e == null) return "sdk";
        switch (e.getClass().getSimpleName()) {
            case "RuStoreNotInstalledException": return "no-rustore";
            case "RuStoreOutdatedException": return "outdated";
            case "RuStoreUserUnauthorizedException": return "unauthorized";
            case "RuStoreUserBannedException": return "user-banned";
            case "RuStoreApplicationBannedException": return "app-banned";
            case "RuStoreConnectionTimeout": return "timeout";
            default: return "sdk";
        }
    }

    private static JSObject fail(String reason, Throwable e) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("reason", reason);
        if (e != null) {
            r.put("error", e.getClass().getSimpleName());
            // только для диагностики (CDP/логи); на экран не выводится - там честная строка из update.js
            String m = e.getMessage();
            if (m != null) r.put("message", m.length() > 200 ? m.substring(0, 200) : m);
        }
        return r;
    }

    @PluginMethod
    public void checkUpdate(final PluginCall call) {
        if (!sdkSupported()) { call.resolve(fail("old-android", null)); return; }
        if (!ruStoreInstalled()) { call.resolve(fail("no-rustore", null)); return; }
        try {
            manager().getAppUpdateInfo()
                .addOnSuccessListener(new OnSuccessListener<AppUpdateInfo>() {
                    @Override public void onSuccess(AppUpdateInfo info) {
                        JSObject r = new JSObject();
                        r.put("ok", true);
                        r.put("available", info.getUpdateAvailability() == UpdateAvailability.UPDATE_AVAILABLE);
                        r.put("versionCode", info.getAvailableVersionCode());
                        r.put("currentVersionCode", currentVersionCode());
                        call.resolve(r);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable e) { call.resolve(fail(reasonOf(e), e)); }
                });
        } catch (Throwable e) {
            call.resolve(fail(reasonOf(e), e));
        }
    }

    @PluginMethod
    public void startUpdate(final PluginCall call) {
        if (!sdkSupported()) { call.resolve(storeFallback("old-android", null)); return; }
        if (!ruStoreInstalled()) { call.resolve(storeFallback("no-rustore", null)); return; }
        try {
            manager().getAppUpdateInfo()
                .addOnSuccessListener(new OnSuccessListener<AppUpdateInfo>() {
                    @Override public void onSuccess(AppUpdateInfo info) {
                        if (info.getUpdateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
                            call.resolve(storeFallback("no-update", null));
                            return;
                        }
                        // ревью M-1: окно RuStore только если IMMEDIATE разрешён; иначе карточка в RuStore
                        if (!info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                            call.resolve(storeFallback("not-allowed", null));
                            return;
                        }
                        try {
                            AppUpdateOptions opts = new AppUpdateOptions.Builder().appUpdateType(AppUpdateType.IMMEDIATE).build();
                            manager().startUpdateFlow(info, opts)
                                .addOnSuccessListener(new OnSuccessListener<Integer>() {
                                    @Override public void onSuccess(Integer code) { call.resolve(flowResult(code)); }
                                })
                                .addOnFailureListener(new OnFailureListener() {
                                    // SDK 10.5.1 отдаёт ACTIVITY_NOT_FOUND ошибкой (RuStoreInstallException(2))
                                    @Override public void onFailure(Throwable e) { call.resolve(storeFallback(reasonOf(e), null)); }
                                });
                        } catch (Throwable e) {
                            call.resolve(storeFallback(reasonOf(e), null));
                        }
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override public void onFailure(Throwable e) { call.resolve(storeFallback(reasonOf(e), null)); }
                });
        } catch (Throwable e) {
            call.resolve(storeFallback(reasonOf(e), null));
        }
    }

    // Коды окна обновления (javap ru.rustore.sdk.activitylauncher.ActivityLauncherResult, SDK 10.5.1):
    // ActivityResultOk = -1 (Activity.RESULT_OK), ActivityResultCanceled = 0, ActivityNotFound = 2.
    static final int FLOW_OK = -1;
    static final int FLOW_CANCELED = 0;
    static final int FLOW_ACTIVITY_NOT_FOUND = 2;

    /** Ревью 07.10 (I-1): успех - ТОЛЬКО RESULT_OK. Код 0 по доке SDK = «отмена пользователем ИЛИ ошибка»
     *  (нет места, установка отклонена, сбой RuStore) - открываем карточку в RuStore, как и при
     *  ACTIVITY_NOT_FOUND и неизвестном коде: «нажал - ничего не произошло» не бывает. */
    JSObject flowResult(Integer code) {
        int c = code == null ? FLOW_ACTIVITY_NOT_FOUND : code;
        if (c == FLOW_OK) {
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("via", "sdk");
            r.put("code", c);
            return r;
        }
        return storeFallback(c == FLOW_CANCELED ? "flow-canceled" : "flow", c);
    }

    /** карточка приложения в RuStore (или страница в браузере) + почему не окно обновления */
    private JSObject storeFallback(String reason, Integer code) {
        JSObject r = openStoreResult();
        r.put("reason", reason);
        if (code != null) r.put("code", code);
        return r;
    }

    @PluginMethod
    public void openStore(PluginCall call) {
        call.resolve(openStoreResult());
    }

    /** Карточка приложения в RuStore (deeplink), без RuStore - страница в браузере. */
    private JSObject openStoreResult() {
        JSObject r = new JSObject();
        String pkg = getContext().getPackageName();
        if (tryOpen(STORE_DEEPLINK + pkg)) { r.put("ok", true); r.put("via", "store"); return r; }
        if (tryOpen(STORE_WEB + pkg)) { r.put("ok", true); r.put("via", "web"); return r; }
        r.put("ok", false);
        return r;
    }

    private boolean tryOpen(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Throwable t) {
            return false;
        }
    }
}
