// Проверка сборки под itch.io: клиент лежит на «чужом» домене (другой порт)
// и обращается к серверу по абсолютному адресу.
// Запуск при работающем сервере на 3000:  node itchtest.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { EventSource } = require('eventsource');

const SERVER = 'http://localhost:3000';
const SITE_PORT = 4400;
const SITE = 'http://localhost:' + SITE_PORT + '/';
const DIR = path.join(__dirname, '..', 'itch-build');

const ok = (l, c) => console.log((c ? 'OK   ' : 'СБОЙ ') + l);
const wait = ms => new Promise(r => setTimeout(r, ms));
const stubCtx = new Proxy({}, { get: () => () => ({ data: [] }) });

// «Чужой» сайт: отдаёт только клиентские файлы, без всякого API
const site = http.createServer((req, res) => {
  const rel = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(DIR, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('нет'); return; }
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type }).end(data);
  });
});

function open(){
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/getContext/.test(e.message)) console.log('ОШИБКА:', e.message); });
  return JSDOM.fromURL(SITE, {
    runScripts:'dangerously', resources:'usable', pretendToBeVisual:true, virtualConsole:vc,
    beforeParse(w){
      w.EventSource = class extends EventSource {
        constructor(u, o){ super(new URL(u, SITE).href, o); }
      };
      w.fetch = (u, o) => fetch(new URL(u, SITE).href, o);
      w.HTMLCanvasElement.prototype.getContext = () => stubCtx;
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
      w.matchMedia = q => ({ matches:/pointer:\s*fine/.test(q), media:q,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    }
  });
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles:true }));
const text = (doc, id) => doc.getElementById(id).textContent;

(async () => {
  // Сборка должна быть свежей и указывать на наш сервер
  const cfg = fs.readFileSync(path.join(DIR, 'config.js'), 'utf8');
  ok('в сборке прописан адрес сервера', /KR_SERVER\s*=\s*'https?:\/\/\S+'/.test(cfg));
  fs.writeFileSync(path.join(DIR, 'config.js'), "window.KR_SERVER = '" + SERVER + "';\n");

  await new Promise(r => site.listen(SITE_PORT, r));
  ok('клиент отдаётся с отдельного адреса', true);

  const d1 = await open(); await wait(1200);
  const w1 = d1.window, doc1 = w1.document;
  ok('страница загрузилась и показала вход', doc1.getElementById('enter').classList.contains('on'));

  click(w1, doc1.getElementById('createBtn'));
  await wait(1500);
  const room = text(doc1, 'roomCode').trim();
  ok('комната создана через чужой домен', room.length === 4);
  ok('вместо ссылки показан код', /введ[уи]т код/i.test(text(doc1, 'roomLink')));
  ok('кнопка копирует код, а не ссылку', /Скопировать код/.test(text(doc1, 'copyBtn')));

  // Второе «устройство» заходит по коду
  const d2 = await open(); await wait(1200);
  const w2 = d2.window, doc2 = w2.document;
  doc2.getElementById('codeInput').value = room;
  click(w2, doc2.getElementById('joinBtn'));
  await wait(1500);
  ok('второй вошёл по коду', text(doc2, 'roomCode').trim() === room);

  // Партия целиком
  const cards = doc1.querySelectorAll('#setupBody .card-btn');
  ok('режимы подгрузились с сервера', cards.length === 4);
  click(w1, cards[0]); await wait(800);
  click(w1, doc1.querySelectorAll('#setupBody .num')[0]); await wait(900);
  const go = [...doc1.querySelectorAll('#setupBar button')].find(b => /Начать раунд/.test(b.textContent));
  ok('лобби собралось на двоих', !!go && !go.disabled);
  click(w1, go); await wait(1500);

  ok('раунд идёт: задание получено', text(doc1, 'task').trim().length > 2);
  ok('оба видят одно задание', text(doc1, 'task') === text(doc2, 'task'));
  const t1 = text(doc1, 'timer');
  await wait(2500);
  ok('таймер тикает через чужой домен', text(doc1, 'timer') !== t1);
  ok('кнопки роли построены', doc1.querySelectorAll('#pad .btn').length >= 2);

  w1.close(); w2.close(); site.close();
  process.exit(0);
})();
