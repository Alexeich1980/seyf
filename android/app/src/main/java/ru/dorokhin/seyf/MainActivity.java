package ru.dorokhin.seyf;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // СТОР-сборка (build-apk.js --store → -PseyfStore=true → bool/seyf_store, 1.3.0): код
        // меняется только через RuStore. Путь к скачанной когда-то веб-сборке (OTA прямой раздачи,
        // CapWebViewSettings/serverBasePath) забываем ДО старта моста - Bridge читает его в
        // super.onCreate. Так стор-оболочка всегда грузит встроенный www (как в «Хомяке»).
        if (isStoreBuild()) {
            try {
                getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().remove(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH).commit();
            } catch (Throwable ignored) {}
        }

        // Свой плагин регистрируется ДО super.onCreate: мост собирает список плагинов
        // при создании, всё, что позже, он уже не увидит.
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(RuStorePayPlugin.class);
        super.onCreate(savedInstanceState);

        // FLAG_SECURE: запрет скриншотов/записи экрана и пустой эскиз в списке недавних.
        // Для менеджера паролей это базовая защита содержимого. В ОТЛАДОЧНОЙ сборке снимаем
        // (флаг debuggable в манифесте ставит debug-сборка) - иначе ни adb screencap, ни
        // CDP-снимок не работают, и живой визуальный QA на устройстве невозможен. Релиз
        // (не debuggable, build.gradle release: debuggable false) остаётся защищённым.
        boolean debuggable = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable) {
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
            // Отладка WebView (chrome://inspect) в релизе выключена: Capacitor и так берёт её из
            // debuggable, здесь - явный второй заслон (расшифрованный сейф живёт в WebView).
            android.webkit.WebView.setWebContentsDebuggingEnabled(false);
        }

        // Свой масштаб текста: системный «размер шрифта» иначе ломает вёрстку списков.
        getBridge().getWebView().getSettings().setTextZoom(100);

        // Android Autofill (1.3.0): WebView с расшифрованным сейфом исключён из автозаполнения
        // целиком (вместе с потомками) - сторонний сервис автозаполнения не видит и не
        // запоминает поля мастер-пароля и записей. API 26+ (Android 8), ниже Autofill нет.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getBridge().getWebView().setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }

        // RuStore Pay (1.3.0): возврат из банковского приложения (СБП/SberPay) приходит deeplink'ом
        // ru.dorokhin.seyf.rustore://… - SDK должен его обработать, чтобы довести оплату.
        if (savedInstanceState == null) RuStorePayPlugin.proceedIntent(getApplicationContext(), getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        RuStorePayPlugin.proceedIntent(getApplicationContext(), intent);
    }

    private boolean isStoreBuild() {
        try {
            int id = getResources().getIdentifier("seyf_store", "bool", getPackageName());
            return id != 0 && getResources().getBoolean(id);
        } catch (Throwable t) {
            return false;
        }
    }
}
