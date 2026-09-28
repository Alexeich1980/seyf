// demo.js — демо-режим первого запуска «Сейфа» (ТОЛЬКО мобайл, НЕ core; как seed/totp/gate).
// Задача: «сначала посмотреть, потом мастер-пароль». Когда vault ещё не создан, приложение
// открывается сразу в рабочей оболочке, наполненной ОДНОЙ демо-записью в каждом разделе —
// человек видит, как всё выглядит и работает, до всякого ввода пароля.
//
// ЖЁСТКИЙ ИНВАРИАНТ БЕЗОПАСНОСТИ: демо-данные живут ТОЛЬКО в памяти (state.vault) и на диск
// НЕ пишутся. Реальные данные тоже не пишутся, пока не создан мастер-пароль. Заслон —
// guardedSave (бросает в демо-режиме); покрыт тестом + мутацией.
//
// Импорт core (store/documents/totp) — это ИСПОЛЬЗОВАНИЕ ядра, а не его правка: core-файлы
// остаются байт-в-байт с десктопом (core-drift зелёный), демо в десктоп не течёт.
//
// ОТКЛЮЧЕНИЕ ДЛЯ ПРОДА — одной строкой: DEMO_ENABLED = false. Тогда первый запуск снова ведёт
// к экрану создания мастер-пароля (см. onboarding.decideStart), демо не сидируется.
import { emptyVault, createEntry } from './store.js';
import { createPage } from './documents.js';
import { TOTP_DEFAULTS } from './totp.js';

export const DEMO_ENABLED = true;

// Демо-скан для раздела «Документы»: сгенерированная заглушка-PNG «ДЕМО-документ» (палитровый
// PNG, ~2.4 КБ, безопасна и офлайн). Пересоздать: sharp(svg).png({palette:true}) → base64.
export const DEMO_DOC_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAaQAAAEOBAMAAAA05X6OAAAAMFBMVEUeJTA3wqjm6vAuOEKHjZZETFdqcXvV2d9WXWebo6/Bxcx4f4mTmaOvtLwth3s0r5lJH9KFAAAACXBIWXMAAAsTAAALEwEAmpwYAAAIx0lEQVR42u3a72tb1xkH8Ge5vvK1ZTszoW8jc2JHjmLDjVTbabytwkkap01BtePGXkwR+dWGriDUte4aCiLp0mQ0IOLJdWYGxissbVcwjttQPINxm1ICBeNtDWMbxC/6NtT0H9jznHNly3KyrWDZu+L7BJwj3SP5fnSe85xzdU2EQCAQCAQCgfDCerBc79sIPXAfIlqq93WE1puWQt+6Pk6xF5Z3Fj+3vf6+v+dN3TrA0vd+rwVPhoqMIdf35W157TDt2+H/kl1kWL7vf1LdmgJhhcphZV12Hwn0aywVplrdY+VAeq6QtH1HOZD2fVfw4Ec/LgfSGgVIIIEEEkgggQQSSCCBBBJIIIEEEkgggQQSSCCBBBJIIIEEEkgggQQSSCCBBBJIIIEEEkgggQQSSCCBBBJIIIEEEkgggQQSSCCBBBJIIIEEEkggbQbpUD4urbSSdJx/PmOOT3PzsDTaf//hv7p9QeqfDw8NKaU+cdsWlXrzwz8qtUCxd/iZhBy2ufFGjBtPqJaXXlGv+yLxalNEp1QLt6JKxYkGmERBlmTlaE1aqST/76TDCen3Fz+QajRpL7e2aRJNMSnQotQuORqdVypD0qOJf1aosOsDUoUm7eZWpSHVMslpUqpRjt7u0RnoKDXHj6y0GvfDKI2vIdkUEFLDogrL0fcNqcObWl0G6i9SNVmadFHPIWeXIXUZIPGz7v8/qWotqYPIFRI/4ANVC4aUVnt0Z1NBdJzRBf8pbr0y9AF3CfKjOFlfjwa40c3rwFOPm/IflIfS6xvOcun0Nv9wvQWjuyQVb2EN6bZ+0mngmscFIZrRJMebWVJB8pOpc8+hp5X6nOiAOtzV6pLNqZqgjrQ6y4vBQdqf/puTVq3ckd/hFveK9KcXpFMk8RNeFyj9z2eV+uJuYylI1XOFJGvII1lKBuZp0iT27dbPc5eG/AubqUan4UQr1Qq0R1aCv/aocTPx3nM5XaVxXZLWSjfRVItk7l5Z6+boApdPfvX7pSBVxgtIB38T9kg0L7/xgiHV5EnVXm2XuGlIFXwoIIMY5R/2q9vUeFBn55+4XMq5W2+qCGcwo3v4nXqYZMnxlCGdKQVpW7KApNQKiS2TzquGVFVAaioiRVWzfO6GVBOv4WUsrVJkcb/ZCW4E7wqph1fuKANXSElD2l8KUk+igPTV7RVSrVKp2rn1o7RCes2QZBG2ZT0WUtSV4tIlA8dTdFbet/rnQupiRVSPlEciQypJxTvlFs4lOz+XpCQ0RxOGVFGYeFLRuLblSdcNaU6T/u7VxQhV8+DPVnLjWrWQFtU/ZqZUw+aQ7tKainckT+L0aX2WDCmg9I5Jd0nVSn42kLXLkBZ5dllK51XkXrNZF/g1J/j/We6QGNGkCfXBjRs3svx2rYeOlZr0Kypelzh3hDTFw+SR+JRb8kU865HslCFNMMmW7XtUtV7n6my279ljQuLG5ylNSptdsJBmpktMspupaPdAwYwm8bKa8kg8FBHvjFSmdogjRYHx1VGyzSg1Vnv7pgnV9JqQ+GBj3Bulce8NSp94Vam1JIcnTEKT+IQn86T8RmjKo8kL5wypy5Bk9jfa3kp8SkXGNUle582lXZtGisapaCdOp8xcsvWvNKQqc9UkH//KepYxpIv8lCOdpDzMm11Gpf40mFTJ63W1qXhyILkppHsu5a+XPJIdke0qNxb3eKnGi79JHMecqo4XyZCqecYF5KyF5O3Yg+ZsZ/m0mw3JVJnsZpBqmk0+NXpzX86VN2YBIV1sMntvuQTs0D0OFFxbfKTHjisJn2SFKSQtUhoX5LrK7HJnuTHOpLDueiF2xF3dEGlSogQke+KjmZmZ6bSKuPrs9165fESK2wE5pUoZmHnv4m+Rd6jORDhZeDF8QnOnwm6H0lsQPWc0el5/Uvd4g5eUMuPKMOsCOsXv7hh3rZfMG0vSv8hE6+mv8829dC2t3uLNapLs3/HjSE5y7j31cTp8cPWzMH1/KV9LvJW+qbNQ7w7UHyRdpej8VN2kd9wgf3vxunwdw3twGSyVfVE35R1aNp7EKfBNr9BOpvVY/Md4fualRMErR3lc2yRJyX757LrtfXzdy9s//V/SbANIb+Tz6L+T1r7S7Casjx+xvXe36qrWDq98cvM/kORdCV57yLHgLTq/ZRfq9u7Vz/WHkRyvmNc+5Nj1PXzhsWWk1OpHO7dhJ5EOO+NbR8quNjeONKGOJLaMZGVW28kNO4kTanfZ3Yy54uL+EkgggQQSSCCBBBJIIIEEEkgggQQSSCCBtCER4yC3zbViLv/jL2pdanMp0SbHrF4+bLlWH1kxK0Z2rz9InXf6RttHj+XsMffP7vkMfZZo77/TOXqU/yCPzg5mBk4PxM91Jttz9kjs8GDCFyQnTjlrlL6gr2iajseto3SWpu2cNcL3qpOByapEknLOHN83yNlzfEfUN6Rhukrdzhnqzznv0pdXLrNgmm+Nyx9GXEmQezLL9z9y5B73FWnA7b70NvXNOIM0rG/mvMs3RTNM+kWGTvZl7ZFzObrc6SvSID2TYNLApUH6kmwmvcyjNEmJqr5ha9jWo+TE/ZJ4fLJWjs6xhEkVk1fp/KV+JvHfGDujdqYqMWMPB7IylwLxx2/5o+LlnJHYWH/SHosd7f20rfezTPDGpD3yPCcdnR+jq7eeOH3sk5HOUWes7beX7/hmqbWGY2uWKp5L+uaYZW6RWT7cPfBcokfd6/XphsjKFU8w35P2F9+E3f9rbFtBAgkkkEACCSSQQAIJJJBAAgkkkEACCSSQQAIJJJBAAgkkkEACCSSQQAIJJJBAAgkkkEACCSSQQAIJJJBAAgkkkEACCSSQQAIJJJDKg7R9RzmQ9n1X8KDusXIgPXe/kLSzHEhLhSQrVA6kZfeRQJ9GUartK4P6UGSoC7l+F1nLRZm29L3fSU8W14Of1ft8NtWtByyFvvVx7lkvLK9fh6ylel/HzocMiPVg2b+g0APflzcEAoFAIBCIjYt/Aw+/bQdY2R4sAAAAAElFTkSuQmCC';

// Строгий признак демо-записи: только demo === true. Любые «похожие» значения — не демо.
export function isDemoEntry(entry) {
  return !!(entry && entry.demo === true);
}

// Сидирование демо: ОДНА реалистичная, но безопасная запись в каждом разделе.
// Используем core-createEntry (id/флаги/пуш) — DRY, без правки ядра. Всё помечено demo:true.
export function seedDemoVault() {
  const v = emptyVault();

  createEntry(v, 'passwords', {
    demo: true,
    description: 'Почта (пример)',
    url: 'mail.example.com',
    login: 'demo@example.com',
    password: 'Prim3r-Parolya-2026',
  });

  createEntry(v, 'cards', {
    demo: true,
    bank: 'Демо-банк',
    number: '0000000000001234',
    holder: 'IVAN IVANOV',
    expiry: '12/29',
    cvv: '123',
    pin: '0000',
  });

  createEntry(v, 'wallets', {
    demo: true,
    description: 'Пример кошелька',
    url: 'wallet.example.com',
    number: '0xDEMO0000000000000000000000000000001234',
    password: 'primer-dostupa',
  });

  createEntry(v, 'seed', {
    demo: true,
    name: 'Демо-кошелёк (тест)',
    // ЗАВЕДОМО тестовый вектор BIP39 — публичный, к нему нельзя привязать реальные средства.
    phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    network: 'Тестовая сеть',
    note: 'Это заведомо ТЕСТОВАЯ фраза из общедоступного вектора. Никогда не используйте её для реальных активов.',
  });

  createEntry(v, 'documents', {
    demo: true,
    description: 'Демо-документ',
    number: '00 00 000000',
    issueDate: '2019-06-20',
    expiry: '20.06.2029',                          // срок полной датой ДД.ММ.ГГГГ (18.10)
    comments: 'Пример скана - не настоящий документ',
    pages: [createPage({ name: 'ДЕМО-документ.png', mime: 'image/png', data: DEMO_DOC_PNG })],
  });

  createEntry(v, 'notes', {
    demo: true,
    title: 'Пример заметки',
    text: 'Здесь может быть любой личный текст: коды доступа, ответы на контрольные вопросы, важные напоминания. В демо-режиме это лишь пример.',
  });

  createEntry(v, 'totp', {
    demo: true,
    name: 'Демо-сервис',
    // Валидный base32 — код 2FA реально тикает в карточке (показываем фишку).
    secret: 'JBSWY3DPEHPK3PXP',
    digits: TOTP_DEFAULTS.digits,
    period: TOTP_DEFAULTS.period,
    algorithm: TOTP_DEFAULTS.algorithm,
  });

  createEntry(v, 'contacts', {
    demo: true,
    name: 'Иван Петров (пример)',
    phone: '+7 900 000-00-00',
    link: 'https://t.me/example',
    note: 'Пример контакта. Кнопка «Позвонить» наберёт номер, «Открыть» - перейдёт по ссылке.',
  });

  createEntry(v, 'wifi', {
    demo: true,
    ssid: 'HomeNet (пример)',
    password: 'primer-parolya-wifi',
    note: 'Пароль скрыт и копируется одним касанием.',
  });

  createEntry(v, 'requisites', {
    demo: true,
    bank: 'Демо-банк',
    account: '40817810099910004321',
    bik: '044525225',
    corr: '30101810400000000225',
    inn: '7710140679',
    iban: 'DE89370400440532013000',
    note: 'Пример реквизитов для перевода. Числовые поля копируются одним касанием.',
  });

  return v;
}

// Заслон персистентности. Оборачивает store.save: в демо-режиме бросает и НЕ пишет на диск
// (жёсткий инвариант «в демо ничего не сохраняется»). isDemo — функция-геттер текущего режима.
// В норме недостижим (мутации перехватываются до сохранения), но служит машинным заслоном.
export function guardedSave(store, isDemo) {
  return async (file, opts) => {
    if (isDemo()) throw new Error('demo-mode: запись на диск запрещена (данные не сохраняются)');
    return store.save(file, opts);   // opts.onProgress - пульс сторожа записи (1.2.24, п.4)
  };
}
