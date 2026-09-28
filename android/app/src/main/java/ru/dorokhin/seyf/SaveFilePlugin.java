package ru.dorokhin.seyf;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * SaveFile — «Сохранить как» руками Android.
 *
 * Зачем свой плагин. Бэкап раньше уходил через Filesystem+Share: файл ложился в кэш
 * приложения, а дальше открывалась «Поделиться». Хозяин видел список мессенджеров
 * вместо папки, файл оставался во временной памяти, и «куда я его сохранил» было
 * непонятно. Здесь открывается системное окно сохранения (ACTION_CREATE_DOCUMENT):
 * хозяин сам выбирает папку и имя, файл ложится туда, куда он сказал.
 *
 * Новых разрешений не нужно: SAF выдаёт право записи на ОДИН выбранный документ.
 *
 * JS-сторона: NativePlugins.SaveFile.save({name, mime, base64})
 *   → {ok:true, uri:'content://…'}          — сохранил
 *   → {ok:false, cancelled:true}            — хозяин закрыл окно, это не ошибка
 *   → reject(код NO_DATA|NO_PICKER|NO_STREAM) — телефон не дал записать
 *
 * Наружу уходит КОД, а не текст исключения Java: английские «Failed to open output
 * stream» и «EACCES (Permission denied)» хозяину читать незачем, слова подбирает
 * sync.js по коду.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    /** Имя документа для SAF: разделители пути и служебные знаки часть прошивок ломают. */
    static String safeName(String raw, String dflt) {
        if (raw == null) return dflt;
        StringBuilder b = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c < 32 || c == 127 || "/\\:*?\"<>|".indexOf(c) >= 0) b.append(' ');
            else b.append(c);
        }
        String s = b.toString().replaceAll("\\s+", " ").trim();
        s = s.replaceAll("^[.\\s]+", "");
        if (s.length() > 80) {
            int dot = s.lastIndexOf('.');
            String ext = (dot > 0 && s.length() - dot <= 10) ? s.substring(dot) : "";
            s = s.substring(0, 80 - ext.length()).trim() + ext;
        }
        return s.isEmpty() ? dflt : s;
    }

    @PluginMethod
    public void save(PluginCall call) {
        String name = safeName(call.getString("name", "backup.bin"), "backup.bin");
        String mime = call.getString("mime", "application/octet-stream");
        String b64 = call.getString("base64");
        if (b64 == null) {
            call.reject("нечего сохранять", "NO_DATA");
            return;
        }

        // ЗАСЛОН TransactionTooLargeException (корень «после Сохранить приложение
        // закрылось»): большой сейф со сканами в base64 весит мегабайты. Пока окно
        // выбора папки (отдельная активность) впереди, Android останавливает нашу
        // активность и сериализует УДЕРЖАННЫЙ вызов в savedInstanceState. Если base64
        // остаётся в опциях вызова, парсел переваливает лимит Binder (~1 МБ) и процесс
        // падает уже на activityStopped - ещё до записи файла. Поэтому байты СРАЗУ
        // сбрасываем во временный файл кэша, а из вызова base64 УБИРАЕМ: и через мост,
        // и через сохранение состояния уезжает только короткий путь к файлу.
        File tmp;
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            tmp = File.createTempFile("seyf-backup", ".bin", getContext().getCacheDir());
            FileOutputStream fos = new FileOutputStream(tmp);
            try { fos.write(bytes); fos.flush(); } finally { fos.close(); }
        } catch (Exception e) {
            call.reject("не удалось подготовить файл", "NO_STAGE");
            return;
        }
        try {
            call.getData().remove("base64");                 // тяжёлое поле вон из вызова
            call.getData().put("tmp", tmp.getAbsolutePath()); // остаётся только путь
        } catch (Exception e) {
            tmp.delete();
            call.reject("не удалось подготовить файл", "NO_STAGE");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
            // startActivityForResult сам придержит call до ответа окна (теперь он лёгкий)
            startActivityForResult(call, intent, "saved");
        } catch (Exception e) {
            // Системного окна «Сохранить как» нет вовсе (SAF отключён, урезанная
            // прошивка): без этой ветки обещание в JS не разрешалось НИКОГДА и
            // «Бэкап в файл» молча висел без ошибки и без отмены.
            tmp.delete();
            call.reject("нет системного окна сохранения", "NO_PICKER");
        }
    }

    @ActivityCallback
    private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;

        String tmpPath = call.getString("tmp");
        File tmp = (tmpPath != null) ? new File(tmpPath) : null;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        Uri uri = (data == null) ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            // отмена — обычный исход, а не сбой: наверху по нему просто молчат
            if (tmp != null) tmp.delete();
            ret.put("ok", false);
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        try {
            if (tmp == null || !tmp.exists()) throw new Exception("нет временного файла");
            // «wt» — перезаписать целиком: без него поверх старого файла остаётся хвост.
            // Копируем потоком из временного файла — байты в память разом не поднимаем.
            OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (out == null) throw new Exception("телефон не открыл файл на запись");
            InputStream in = new FileInputStream(tmp);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                out.flush();
            } finally {
                in.close();
                out.close();
            }
            ret.put("ok", true);
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            // текст исключения наружу не отдаём - только код, слова подберёт JS
            call.reject("телефон не дал записать файл", "NO_STREAM");
        } finally {
            if (tmp != null) tmp.delete();
        }
    }
}
