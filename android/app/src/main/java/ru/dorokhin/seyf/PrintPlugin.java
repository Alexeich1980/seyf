package ru.dorokhin.seyf;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Print — системная печать Android для листа «Архив для близких» (1.3.3, вариант «Только основная
 * информация»). В окне печати Android есть и «Сохранить как PDF», поэтому отдельного PDF-движка нет.
 *
 * Лист - готовый статичный HTML из js/archive.js (renderSheetHtml): без скриптов, без сети. Его
 * рисует отдельный невидимый WebView с выключенными JavaScript, сетью и доступом к файлам; по
 * готовности страницы WebView отдаёт PrintDocumentAdapter системному PrintManager. Разрешений не нужно.
 *
 * JS-сторона: NativePlugins.Print.print({html, name})
 *   → {ok:true}                      — окно печати ЗАКРЫТО: печать завершена/отменена (адаптер onFinish)
 *                                      или приложение вернулось на передний план после окна печати
 *   → reject(код NO_DATA|NO_PRINT)   — печатать нечего или печать недоступна
 * Ревью 1.3.3 М1: раньше ответ шёл сразу после pm.print, и JS снимал флаг «системное окно», пока окно
 * печати ещё открыто - долгая печать запирала сейф как уход пользователя в фон. Теперь ответ - по
 * завершении печати (onFinish) или по возврату в приложение (handleOnResume после ухода в фон),
 * что наступит раньше; ответ ровно один (pending обнуляется).
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    // Держим WebView, пока идёт печать: иначе сборщик мусора уберёт его вместе с адаптером.
    private WebView printView;
    // Вызов JS, ждущий закрытия окна печати; paused - приложение ушло в фон после pm.print.
    private PluginCall pending;
    private boolean paused = false;

    private void finishPending() {
        PluginCall c = pending;
        pending = null;
        paused = false;
        if (c == null) return;   // printView не трогаем: адаптер может ещё дописывать файл после закрытия окна
        JSObject ret = new JSObject();
        ret.put("ok", true);
        c.resolve(ret);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (pending != null) paused = true;
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pending != null && paused) finishPending();
    }

    @PluginMethod
    public void print(final PluginCall call) {
        final String html = call.getString("html");
        String raw = call.getString("name", "Архив для близких");
        final String job = (raw == null || raw.trim().isEmpty()) ? "Архив для близких" : raw.trim();
        if (html == null || html.isEmpty()) {
            call.reject("нечего печатать", "NO_DATA");
            return;
        }
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (pending != null) finishPending();
                try {
                    WebView wv = new WebView(getActivity());
                    WebSettings s = wv.getSettings();
                    s.setJavaScriptEnabled(false);
                    s.setBlockNetworkLoads(true);
                    s.setAllowFileAccess(false);
                    s.setAllowContentAccess(false);
                    wv.setWebViewClient(new WebViewClient() {
                        private boolean started = false;

                        @Override
                        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }

                        @Override
                        @SuppressWarnings("deprecation")
                        public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }

                        @Override
                        public void onPageFinished(WebView view, String url) {
                            if (started) return;
                            started = true;
                            try {
                                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                                final PrintDocumentAdapter inner = view.createPrintDocumentAdapter(job);
                                // обёртка: всё как у WebView, плюс ответ JS в onFinish (окно печати закрыто)
                                PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                                    @Override
                                    public void onStart() { inner.onStart(); }

                                    @Override
                                    public void onLayout(PrintAttributes oldA, PrintAttributes newA, CancellationSignal cs, LayoutResultCallback cb, Bundle extras) {
                                        inner.onLayout(oldA, newA, cs, cb, extras);
                                    }

                                    @Override
                                    public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal cs, WriteResultCallback cb) {
                                        inner.onWrite(pages, dest, cs, cb);
                                    }

                                    @Override
                                    public void onFinish() {
                                        inner.onFinish();
                                        if (pending == call) finishPending();
                                    }
                                };
                                PrintAttributes attrs = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .build();
                                pending = call;
                                paused = false;
                                pm.print(job, adapter, attrs);
                            } catch (Exception e) {
                                if (pending == call) pending = null;
                                call.reject("печать недоступна", "NO_PRINT");
                            }
                        }
                    });
                    printView = wv;
                    wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Exception e) {
                    call.reject("печать недоступна", "NO_PRINT");
                }
            }
        });
    }
}
