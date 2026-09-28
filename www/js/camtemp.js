// camtemp.js - уборка временных фото камеры (1.2.23, B2). Mobile-only, чистая логика поверх
// инъектируемого плагина Filesystem (в тесте - фейк).
//
// Корень: снимок через <input capture> делает сам Capacitor (BridgeWebChromeClient.createImageFile):
// файл JPEG_<дата>_<n>.jpg во ВНЕШНЕЙ папке приложения getExternalFilesDir(Pictures). Он
// переживает съёмку: скан документа (паспорт!) лежал там открытым JPEG, пока приложение не
// удалят, - хотя в сейф попадает только зашифрованная копия. Удаляем такие файлы через плагин
// Filesystem (Directory.External = getExternalFilesDir(null), подпапка Pictures; прав не нужно)
// после каждой съёмки и при старте приложения.
export const CAM_DIR = 'Pictures';
export const CAM_DIRECTORY = 'EXTERNAL';
export const CAM_TEMP_RE = /^JPEG_.*\.jpg$/i;

// Удалить временные фото камеры. Возвращает число удалённых. Любая ошибка - тихо (уборка).
export async function cleanupCameraTemp(fs) {
  if (!fs || typeof fs.readdir !== 'function' || typeof fs.deleteFile !== 'function') return 0;
  let r;
  try { r = await fs.readdir({ path: CAM_DIR, directory: CAM_DIRECTORY }); } catch (e) { return 0; }
  let n = 0;
  for (const f of (r && r.files) || []) {
    const name = typeof f === 'string' ? f : f && f.name;
    if (!name || !CAM_TEMP_RE.test(name)) continue;
    if (f && typeof f === 'object' && f.type === 'directory') continue;
    try { await fs.deleteFile({ path: CAM_DIR + '/' + name, directory: CAM_DIRECTORY }); n++; } catch (e) {}
  }
  return n;
}
