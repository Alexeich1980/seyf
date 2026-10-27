// faq-133.test.mjs - «Частые вопросы» в «О приложении» (1.3.3, Алексей «да» 27.10.2026): 7 вопросов из
// черновика, каждый - раскрывашка со стрелкой; блок между «Безопасностью» и «Документами»; ссылки на документы
// и сайт как были. Факты ответов привязаны к коду: если поменяется кнопка или разрешение, тест покраснеет
// раньше, чем ответ станет неправдой.
// Мутации (27.10.2026, все красные): убрать вопрос; вернуть «если я забыл»; убрать стрелку disc-arr; поставить
// блок после «Документов»; переименовать «Восстановить покупку» в окне покупки; добавить разрешение в манифест;
// allowBackup=true; закрывать окно по Enter на вопросе.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAQ, FAQ_TITLE } from '../www/js/faq.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const APP = read('www', 'js', 'app.js');
const HTML = read('www', 'index.html');
const about = (() => { const i = APP.indexOf('function openAbout('); return APP.slice(i, APP.indexOf('\n}\n', i)); })();

test('8 вопросов: 7 из черновика + файл архива (ревью 1.3.3), по порядку', () => {
  assert.equal(FAQ_TITLE, 'Частые вопросы');
  assert.deepEqual(FAQ.map((f) => f.q), [
    'Как перенести данные на новый телефон?',
    'Что делать, если забыли мастер-пароль?',
    'Как сделать резервную копию и где её хранить?',
    'Почему нет облака?',
    'Как восстановить покупку полной версии?',
    'Зачем Сейфу камера, биометрия и интернет?',
    'Можно ли проверить, что данные никуда не уходят?',
    'Как близкий откроет файл архива?',   // ревью 1.3.3
  ]);
  // факт ответа: файл открывается в браузере паролем, Сейф ставить не нужно (archive.js buildEncryptedHtml)
  assert.match(FAQ[7].a, /в браузере телефона или компьютера/);
  assert.match(FAQ[7].a, /пароль, который вы передали ему отдельно/);
  assert.match(FAQ[7].a, /Ставить Сейф не нужно/);
  for (const f of FAQ) assert.ok(f.a.length > 40, 'есть ответ: ' + f.q);
});

test('тексты: «вы», без «я забыл», без длинного тире, ссылка полная https', () => {
  const all = FAQ.map((f) => f.q + ' ' + f.a).join(' ');
  assert.ok(!/(?<![а-яё])(забыл|ты|тебе|твой)(?![а-яё])/iu.test(all));
  assert.ok(!all.includes('—'));
  const link = FAQ[6].link;
  assert.equal(link.url, 'https://github.com/Alexeich1980/seyf');
  assert.ok(FAQ[6].a.includes(link.url));
});

test('«О приложении»: блок вопросов - раскрывашки со стрелкой, между «Безопасностью» и «Документами»', () => {
  const iSec = about.indexOf('>Безопасность<'), iFaq = about.indexOf('FAQ_TITLE'), iDocs = about.indexOf('>Документы<');
  assert.ok(iSec > 0 && iSec < iFaq && iFaq < iDocs);
  assert.match(about, /<details class="disclose"><summary>\$\{UI\.escapeHtml\(f\.q\)\}<span class="disc-arr" aria-hidden="true"><\/span><\/summary>/);
  assert.match(about, /data-url="https:\/\/dorokhin-finance\.ru\/seyf-store\/privacy\.html"/, 'документы на месте');
  assert.match(about, /data-url="https:\/\/dorokhin-finance\.ru\/"/, 'сайт на месте');
  assert.match(about, /e\.key === 'Enter' && !\(e\.target && e\.target\.closest && e\.target\.closest\('summary'\)\)/, 'Enter на вопросе не закрывает окно');
  assert.match(about, /focus\(\{ preventScroll: true \}\);\s*m\.scrollTop = 0;/, 'окно открывается с начала, а не прокрученным к «Понятно»');
  const CSS = read('www', 'css', 'app.css');
  assert.match(CSS, /details\.disclose\[open\] \.disc-arr::before \{ transform:/);
});

test('факты ответов совпадают с приложением', () => {
  // перенос и копия: пункты окна «Резервная копия»
  assert.match(APP, /<span class="backup-card-t">Сохранить копию<\/span>/);
  assert.match(APP, /<span class="backup-card-t">Восстановить из файла<\/span>/);
  assert.match(HTML, /class="mi-t">Резервная копия</);
  // забыли пароль: «Показать подсказку» на входе; смена только со старым паролем
  assert.match(HTML, /id="showHint"[^>]*>Показать подсказку</);
  assert.match(APP, /Введите действующий мастер-пароль/);
  // покупка: «Восстановить покупку» и ключ в окне «Полная версия»
  assert.match(APP, />Восстановить покупку</);
  assert.match(APP, />Есть ключ</);
  // облако: системная копия Android выключена
  const MAN = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.match(MAN, /android:allowBackup="false"/);
  // разрешения: только интернет, биометрия, камера
  const perms = [...MAN.matchAll(/<uses-permission android:name="android\.permission\.(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(perms, ['CAMERA', 'INTERNET', 'USE_BIOMETRIC']);
  // напоминание о копии раз в месяц
  assert.match(read('www', 'js', 'backupnudge.js'), /30/);
});
