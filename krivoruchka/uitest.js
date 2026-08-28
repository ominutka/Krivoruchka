// Проверка клиента в эмуляции браузера.
// Требует: npm install jsdom eventsource
// Запуск при работающем сервере:  node uitest.js
const { JSDOM, VirtualConsole } = require('jsdom');
const { EventSource } = require('eventsource');

const ok = (l, c) => console.log((c ? 'OK   ' : 'СБОЙ ') + l);
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = (doc, id) => doc.getElementById(id).textContent;

// Заглушка холста: рисование в тесте не проверяем, важен интерфейс
const stubCtx = new Proxy({}, { get: () => () => ({ data: [] }) });

const BASE = 'http://localhost:3000/';
const abs = u => new URL(u, BASE).href;

function open(){
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    if (!/getContext/.test(e.message)) console.log('ОШИБКА СТРАНИЦЫ:', e.message);
  });
  return JSDOM.fromURL(BASE, {
    runScripts:'dangerously', resources:'usable', pretendToBeVisual:true, virtualConsole:vc,
    beforeParse(w){
      // в эмуляторе относительные адреса не разрешаются сами — дописываем базу
      w.EventSource = class extends EventSource {
        constructor(u, o){ super(abs(u), o); }
      };
      w.fetch = (u, o) => fetch(abs(u), o);
      w.HTMLCanvasElement.prototype.getContext = () => stubCtx;
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
      // эмулятор не разбирает составные медиазапросы; считаем экран узким,
      // но с мышью и клавиатурой — иначе не проверить подписи клавиш
      w.matchMedia = q => ({ matches: /pointer:\s*fine/.test(q), media:q, onchange:null,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    }
  });
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles:true }));

(async () => {
  const d1 = await open(); await wait(1300);
  const w1 = d1.window, doc1 = w1.document;

  // сервер мог остаться в середине прошлой партии — возвращаем к выбору режима
  const cid1 = w1.sessionStorage.getItem('kr-cid');
  const send = b => fetch(abs('/msg'), { method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...b, cid: cid1 }) });
  await send({ type:'claim' });  await wait(200);
  await send({ type:'stop' });   await wait(200);
  await send({ type:'remode' }); await wait(500);

  ok('экран выбора режима показан сразу', doc1.getElementById('setup').classList.contains('on'));
  const cards = doc1.querySelectorAll('#setupBody .card-btn');
  ok('ведущему видны четыре режима', cards.length === 4);
  ok('заголовок про выбор режима', /Во что играем/.test(text(doc1,'setupBody')));

  const d2 = await open(); await wait(1300);
  const w2 = d2.window, doc2 = w2.document;
  ok('второму показан экран ожидания', /Ведущий выбирает режим/.test(text(doc2,'setupBody')));
  ok('второму доступна кнопка ведения',
     [...doc2.querySelectorAll('#setupBar button')].some(b => /Забрать ведение/.test(b.textContent)));

  click(w1, cards[2]);                       // «Крот»
  await wait(900);
  ok('после режима — экран состава', /Сколько нас/.test(text(doc1,'setupBody')));
  ok('второй видит, что идёт выбор состава', /Ведущий выбирает состав/.test(text(doc2,'setupBody')));

  const nums = doc1.querySelectorAll('#setupBody .num');
  ok('кнопки состава на месте', nums.length === 5);
  click(w1, nums[0]);                        // двое
  await wait(900);
  ok('перешли в лобби', /Разбираем роли/.test(text(doc1,'setupBody')));
  ok('второй тоже в лобби', /Разбираем роли/.test(text(doc2,'setupBody')));

  const go = [...doc1.querySelectorAll('#setupBar button')].find(b => /Начать раунд/.test(b.textContent));
  ok('кнопка начала доступна при двух игроках', !!go && !go.disabled);
  click(w1, go);
  await wait(1200);

  ok('экран настройки закрылся', !doc1.getElementById('setup').classList.contains('on'));
  ok('у второго тоже закрылся', !doc2.getElementById('setup').classList.contains('on'));
  ok('задание показано', text(doc1,'task').trim().length > 2);
  ok('кнопки роли построены', doc1.querySelectorAll('#pad .btn').length >= 2);
  ok('у второго свои кнопки', doc2.querySelectorAll('#pad .btn').length >= 2);
  ok('роли у игроков разные', text(doc1,'myRole') !== text(doc2,'myRole'));
  ok('в режиме «Крот» слова различаются', text(doc1,'task') !== text(doc2,'task'));

  // --- клавиатура и таймер -------------------------------------------------
  const keyEv = (w, type, code) => w.document.dispatchEvent(
    new w.KeyboardEvent(type, { code, bubbles:true, cancelable:true }));

  const before = doc1.getElementById('timer').textContent;
  await wait(2500);
  ok('таймер идёт', doc1.getElementById('timer').textContent !== before);
  ok('у второго таймер тоже идёт', doc2.getElementById('timer').textContent !== before);

  const btns1 = [...doc1.querySelectorAll('#pad .btn')].map(b => b.dataset.action);
  console.log('     кнопки первого игрока:', btns1.join(', '));
  ok('подписи клавиш проставлены', doc1.querySelectorAll('#pad .key').length > 0);

  // Зажимаем две клавиши одновременно — то, чего не умеет мышь
  const holds = btns1.filter(a => ['right','down','left','up','draw','erase'].includes(a));
  keyEv(w1, 'keydown', { right:'KeyD', down:'KeyS', left:'KeyA', up:'KeyW', draw:'Space', erase:'KeyE' }[holds[0]]);
  keyEv(w1, 'keydown', { right:'KeyD', down:'KeyS', left:'KeyA', up:'KeyW', draw:'Space', erase:'KeyE' }[holds[1]]);
  await wait(300);
  ok('две клавиши зажаты одновременно', doc1.querySelectorAll('#pad .btn.down').length === 2);

  keyEv(w1, 'keyup', { right:'KeyD', down:'KeyS', left:'KeyA', up:'KeyW', draw:'Space', erase:'KeyE' }[holds[0]]);
  await wait(250);
  ok('отпускание одной клавиши не гасит вторую', doc1.querySelectorAll('#pad .btn.down').length === 1);

  w1.close(); w2.close();
  process.exit(0);
})();
