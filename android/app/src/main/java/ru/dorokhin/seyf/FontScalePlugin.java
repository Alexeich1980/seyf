package ru.dorokhin.seyf;

import android.content.res.Configuration;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * FontScale - крупный системный шрифт (1.3.3, образец «Карта года» FontScalePlugin, ревью 07.10 R-1).
 *
 * До 1.3.3 MainActivity ставила setTextZoom(100) - системный «размер шрифта» игнорировался. Теперь
 * textZoom WebView = round(fontScale*100) в пределах 100-200, а JS получает fontScale и ставит
 * html[data-fz] (www/js/fontzoom.js): витрина и меню при крупном шрифте перестраиваются.
 *
 * Смена шрифта при открытом приложении: fontScale в configChanges манифеста - Activity НЕ
 * пересоздаётся (раньше пересоздавалась: сейф запирался, несохранённая форма терялась). Bridge
 * отдаёт новую конфигурацию в handleOnConfigurationChanged - ставим новый textZoom и шлём "change".
 * Запасной путь - handleOnResume сверяет масштаб.
 *
 * JS-контракт: FontScale.get() → {fontScale:number, textZoom:number}; событие "change" с тем же.
 */
@CapacitorPlugin(name = "FontScale")
public class FontScalePlugin extends Plugin {

    static final int ZOOM_MIN = 100;
    static final int ZOOM_MAX = 200;

    private float applied = -1f;

    /** textZoom по масштабу шрифта: 100-200, мусор - 100 */
    static int textZoomFor(float fontScale) {
        if (Float.isNaN(fontScale) || fontScale <= 0f) return ZOOM_MIN;
        int z = Math.round(fontScale * 100f);
        return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    }

    private static float sane(float f) { return (Float.isNaN(f) || f <= 0f) ? 1f : f; }

    private float fontScale() {
        try { return sane(getContext().getResources().getConfiguration().fontScale); }
        catch (Throwable t) { return 1f; }
    }

    /** ставит textZoom; true - масштаб изменился с прошлого раза */
    private boolean apply(float f) {
        try {
            WebView wv = getBridge().getWebView();
            if (wv != null) wv.getSettings().setTextZoom(textZoomFor(f));
        } catch (Throwable ignored) {}
        boolean changed = applied > 0f && Math.abs(applied - f) > 0.001f;
        applied = f;
        return changed;
    }

    private JSObject state() {
        float f = applied > 0f ? applied : fontScale();
        JSObject r = new JSObject();
        r.put("fontScale", (double) f);
        r.put("textZoom", textZoomFor(f));
        return r;
    }

    @Override
    public void load() { apply(fontScale()); }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        float f = newConfig != null ? sane(newConfig.fontScale) : fontScale();
        if (apply(f)) notifyListeners("change", state());
    }

    @Override
    protected void handleOnResume() {
        if (apply(fontScale())) notifyListeners("change", state());
    }

    @PluginMethod
    public void get(PluginCall call) { call.resolve(state()); }
}
