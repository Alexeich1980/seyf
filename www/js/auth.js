// auth.js — мобильная биометрия вместо WebAuthn/Windows Hello.
// Хранит случайный bioKey (base64) в аппаратном Android Keystore за биометрией
// (плагин NativeBiometric). Сам DEK обёрнут этим bioKey в file.helloWrap
// (формат десктопа, crypto.attachHelloRaw/unlockWithHello). В браузере QA плагина
// нет — bioAvailable()=false, приложение остаётся на мастер-пароле.
const SERVER = 'ru.dorokhin.seyf';
const USER = 'seyf';

function plugin() {
  try {
    var NP = window.NativePlugins;
    return (NP && NP.NativeBiometric) ? NP.NativeBiometric : null;
  } catch (e) { return null; }
}

export async function bioAvailable() {
  const p = plugin();
  if (!p || !window.isNativeApp || !window.isNativeApp()) return false;
  try { const r = await p.isAvailable(); return !!(r && r.isAvailable); } catch (e) { return false; }
}

export async function bioVerify() {
  const p = plugin();
  if (!p) throw new Error('биометрия недоступна');
  await p.verifyIdentity({ title: 'Сейф', subtitle: 'Разблокировка', reason: 'Открыть сейф' });
}

export async function bioStoreKey(bioKeyB64) {
  const p = plugin();
  if (!p) throw new Error('биометрия недоступна');
  await p.setCredentials({ username: USER, password: bioKeyB64, server: SERVER });
}

export async function bioGetKey() {
  const p = plugin();
  if (!p) throw new Error('биометрия недоступна');
  const c = await p.getCredentials({ server: SERVER });
  if (!c || !c.password) throw new Error('в Keystore нет ключа');
  return c.password;   // base64 bioKey
}

export async function bioDeleteKey() {
  const p = plugin();
  if (!p) return;
  try { await p.deleteCredentials({ server: SERVER }); } catch (e) {}
}
