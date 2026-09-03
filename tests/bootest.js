// Проверка первого экрана: нет мелькания, кнопки объясняют себя.
// Требует: npm install jsdom eventsource. Запуск при работающем сервере.
// Проверяем, не мелькает ли игровой экран до входа в комнату
const { JSDOM, VirtualConsole } = require('jsdom');
const { EventSource } = require('eventsource');
const BASE='http://localhost:3000/';
const stub=new Proxy({},{get:()=>()=>({data:[]})});
const ok=(l,c)=>console.log((c?'OK   ':'СБОЙ ')+l);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function open(q){
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{ if(!/getContext/.test(e.message)) console.log('ОШИБКА:',e.message); });
  return JSDOM.fromURL(BASE+(q||''),{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,
    beforeParse(w){
      w.EventSource=class extends EventSource{constructor(u,o){super(new URL(u,BASE).href,o);}};
      w.fetch=(u,o)=>fetch(new URL(u,BASE).href,o);
      w.HTMLCanvasElement.prototype.getContext=()=>stub;
      w.matchMedia=q=>({matches:/pointer:\s*fine/.test(q),media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
    }});
}
const click=(w,el)=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
(async()=>{
  const d=await open(); const w=d.window, doc=w.document;
  await wait(60);   // самый первый момент, ещё до ответа сервера
  ok('экран входа виден сразу', doc.getElementById('enter').classList.contains('on'));
  ok('игровой экран скрыт', doc.body.classList.contains('booting'));
  await wait(1200);
  ok('и остаётся скрыт до входа', doc.body.classList.contains('booting'));

  click(w, doc.getElementById('createBtn'));
  await wait(120);   // сразу после нажатия, до ответа сервера
  ok('после создания сразу показан экран настройки', doc.getElementById('setup').classList.contains('on'));
  await wait(1400);
  ok('вход закрылся', !doc.getElementById('enter').classList.contains('on'));

  const cards=doc.querySelectorAll('#setupBody .card-btn');
  click(w, cards[0]); await wait(800);
  click(w, doc.querySelectorAll('#setupBody .num')[0]); await wait(900);

  const go=[...doc.querySelectorAll('#setupBar button')].find(b=>/игрок|раунд/i.test(b.textContent));
  ok('в лобби с одним игроком кнопка объясняет причину', /Ждём второго игрока/.test(go.textContent));
  ok('кнопка сверху тоже', /Нужен второй игрок/.test(doc.getElementById('startBtn').textContent));
  ok('подсказка объясняет, что делать', /Пока вы один/.test(doc.getElementById('setupBody').textContent));

  // Код комнаты должен быть виден прямо здесь: панель «Комната» закрыта
  ok('код комнаты виден на экране настройки',
     doc.getElementById('setupCode').textContent.trim().length === 4);
  ok('кнопка копирования доступна отсюда',
     /Скопировать/.test(doc.getElementById('setupCopy').textContent));
  ok('подсказка ссылается на существующую кнопку',
     !/панели «Комната»/.test(doc.getElementById('setupBody').textContent));

  // второй игрок
  const room=doc.getElementById('roomCode').textContent.trim();
  const d2=await open('?r='+encodeURIComponent(room)); await wait(1400);
  ok('с двумя игроками кнопка стала активной', !go.disabled || /Начать раунд/.test(
      [...doc.querySelectorAll('#setupBar button')].find(b=>/раунд/i.test(b.textContent))?.textContent || ''));
  d.window.close(); d2.window.close(); process.exit(0);
})();
