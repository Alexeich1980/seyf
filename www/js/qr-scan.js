// qr-scan.js — живой разбор QR-кода камерой (только мобайл, не ядро). Тонкая обёртка над
// getUserMedia + jsQR (window.jsQR из вендора). Вся разборка otpauth-строки — в totp.js
// (parseOtpauth), покрыта тестами; здесь только «картинка с камеры → строка». Google-сервисы
// не задействованы: jsQR — чистый JS, работает на любом устройстве (в т.ч. без GMS).
//
// startQrScan(videoEl, canvasEl, { onResult, onError, onTrack }) → возвращает stop().
// onResult(text) вызывается один раз при первом распознанном QR; поток при этом гасится.
// onTrack(track) отдаёт видеодорожку наружу (app.js вешает тап-по-экрану для ручного фокуса).
//
// Заслон п.16 «сканер дёргается и плохо фокусируется»:
//  (а) декод НЕ на каждом кадре (это блокировало главный поток → рывки), а не чаще раза в
//      DECODE_INTERVAL_MS (~160 мс), и на ДАУНСКЕЙЛ-кадре (ширина ~DECODE_WIDTH), не в полном
//      разрешении - jsQR отлично читает QR и с 640px, зато в разы дешевле;
//  (б) getUserMedia c advanced-constraints focusMode:'continuous' + ideal 1280×720 - на многих
//      Android-WebView без этого нет непрерывного автофокуса. applyConstraints/advanced -
//      best-effort: неподдержку камера игнорирует, не падаем.
export const DECODE_INTERVAL_MS = 160;
export const DECODE_WIDTH = 640;

// Размер даунскейл-кадра для декода: не шире DECODE_WIDTH, аспект сохраняем (чистая функция, тест).
export function decodeSize(videoWidth, videoHeight, maxWidth = DECODE_WIDTH) {
  const vw = Math.max(0, Math.floor(videoWidth || 0));
  const vh = Math.max(0, Math.floor(videoHeight || 0));
  if (!vw || !vh) return { width: 0, height: 0 };
  if (vw <= maxWidth) return { width: vw, height: vh };
  const scale = maxWidth / vw;
  return { width: maxWidth, height: Math.max(1, Math.round(vh * scale)) };
}

export function startQrScan(videoEl, canvasEl, { onResult, onError, onTrack } = {}) {
  let stream = null;
  let raf = 0;
  let stopped = false;
  let lastDecode = 0;
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function stop() {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (stream) {
      for (const track of stream.getTracks()) { try { track.stop(); } catch (e) {} }
      stream = null;
    }
  }

  function fail(msg) {
    stop();
    if (onError) onError(msg);
  }

  const decode = typeof window !== 'undefined' ? window.jsQR : undefined;
  if (typeof decode !== 'function') {
    fail('Не удалось загрузить разборщик QR. Введите ключ вручную.');
    return stop;
  }
  const md = (typeof navigator !== 'undefined' && navigator.mediaDevices) || null;
  if (!md || typeof md.getUserMedia !== 'function') {
    fail('Камера недоступна на этом устройстве. Введите ключ вручную.');
    return stop;
  }

  function tick() {
    if (stopped) return;
    const ready = videoEl.readyState === videoEl.HAVE_ENOUGH_DATA && videoEl.videoWidth;
    // Троттлинг декода: между попытками не чаще DECODE_INTERVAL_MS - главный поток свободен,
    // видео не дёргается. Между декодами просто крутим rAF (камера рисуется браузером сама).
    if (ready && (now() - lastDecode >= DECODE_INTERVAL_MS)) {
      lastDecode = now();
      const { width, height } = decodeSize(videoEl.videoWidth, videoEl.videoHeight);
      if (width && height) {
        canvasEl.width = width;
        canvasEl.height = height;
        ctx.drawImage(videoEl, 0, 0, width, height);   // даунскейл в один проход
        const img = ctx.getImageData(0, 0, width, height);
        const found = decode(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (found && found.data) {
          const text = found.data;
          stop();
          if (onResult) onResult(text);
          return;
        }
      }
    }
    raf = requestAnimationFrame(tick);
  }

  // Непрерывный автофокус + разумное разрешение (best-effort: неподдержку камера игнорирует).
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 }, height: { ideal: 720 },
      advanced: [{ focusMode: 'continuous' }],
    },
    audio: false,
  };
  md.getUserMedia(constraints)
    .then((s) => {
      if (stopped) { for (const t of s.getTracks()) { try { t.stop(); } catch (e) {} } return; }
      stream = s;
      videoEl.srcObject = s;
      videoEl.setAttribute('playsinline', 'true');
      const track = s.getVideoTracks && s.getVideoTracks()[0];
      // Повторная попытка включить непрерывный автофокус уже на живой дорожке (часть Android-
      // WebView применяет focusMode только через applyConstraints, а не из getUserMedia).
      if (track && track.applyConstraints) {
        try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch (e) {}
      }
      if (track && onTrack) { try { onTrack(track); } catch (e) {} }
      const play = videoEl.play();
      if (play && typeof play.catch === 'function') play.catch(() => {});
      raf = requestAnimationFrame(tick);
    })
    .catch((e) => {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      fail(denied
        ? 'Нет доступа к камере. Разрешите камеру в настройках или введите ключ вручную.'
        : 'Не удалось включить камеру. Введите ключ вручную.');
    });

  return stop;
}

// Тап-по-экрану = разовая попытка ручной перефокусировки (п.16). Дёргаем focusMode continuous
// заново - на части устройств это перезапускает автофокус на точку в центре. Best-effort:
// возвращаем true, если запрос ушёл, false - если камера не умеет applyConstraints. Чистой её
// не назовёшь (работает с track), но на неё можно навесить тест-заглушку track.
export function refocusTrack(track) {
  if (!track || typeof track.applyConstraints !== 'function') return false;
  try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch (e) { return false; }
  return true;
}
