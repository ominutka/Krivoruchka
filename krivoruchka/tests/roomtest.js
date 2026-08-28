// Проверка комнат. Запуск при работающем сервере:  node roomtest.js
const http = require('http');
const BASE = 'http://localhost:3000';
const got = {};

const get = u => new Promise(r => http.get(u, res => { let s=''; res.on('data',d=>s+=d); res.on('end',()=>r(JSON.parse(s))); }));
function stream(tag, cid, room){
  got[tag] = [];
  return new Promise(r => {
    http.get(BASE + '/stream?cid=' + cid + '&room=' + encodeURIComponent(room), res => {
      res.setEncoding('utf8');
      res.on('data', ch => ch.split('\n').forEach(l => {
        if (l.startsWith('data: ')) { try { got[tag].push(JSON.parse(l.slice(6))); } catch(e){} }
      }));
      r(res);
    });
  });
}
function post(b){
  return new Promise(r => {
    const d = JSON.stringify(b);
    const q = http.request(BASE + '/msg', { method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)} },
      res => { res.resume(); res.on('end', r); });
    q.end(d);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const last = (t, ty) => got[t].filter(m => m.type === ty).at(-1);
const ok = (l, c) => console.log((c ? 'OK   ' : 'СБОЙ ') + l);

(async () => {
  const r1 = (await get(BASE + '/new')).room;
  const r2 = (await get(BASE + '/new')).room;
  ok('созданы две разные комнаты', r1 && r2 && r1 !== r2);
  ok('код из четырёх букв', r1.length === 4);

  // Комната 1: двое
  const A = await stream('A','A1',r1); await wait(150);
  const B = await stream('B','B1',r1); await wait(350);
  // Комната 2: двое
  const C = await stream('C','C2',r2); await wait(150);
  const D = await stream('D','D2',r2); await wait(400);

  ok('в каждой комнате свой ведущий',
     last('A','you').leader === true && last('C','you').leader === true);
  ok('первый из второй комнаты не ведущий в первой', last('C','you').room === r2);
  ok('состав комнат не смешался',
     last('A','roster').connected === 2 && last('C','roster').connected === 2);

  // Первая комната играет, вторая стоит
  await post({ cid:'A1', room:r1, type:'mode', m:'free' });  await wait(200);
  await post({ cid:'A1', room:r1, type:'count', n:2 });      await wait(250);
  await post({ cid:'A1', room:r1, type:'start' });           await wait(400);

  ok('раунд идёт в первой комнате', last('A','round').running === true);
  ok('во второй комнате раунд не начался', last('C','round').running === false);
  ok('вторая осталась на выборе режима', last('C','you').stage === 'mode');

  // Рисуем в первой — во второй ничего не появляется
  // При двух игроках вся первая роль — «вправо, вниз и карандаш»
  const who = role => last('A','you').role === role ? 'A1' : 'B1';
  await post({ cid:who('1'), room:r1, type:'input', action:'right', down:true });
  await post({ cid:who('2'), room:r1, type:'input', action:'up',    down:true });
  await post({ cid:who('1'), room:r1, type:'input', action:'draw',  down:true });
  await wait(600);

  const segs1 = got.A.filter(m => m.type === 't' && m.seg).length;
  const ticks2 = got.C.filter(m => m.type === 't').length;
  ok('в первой комнате рисуется', segs1 > 3);
  ok('во вторую комнату отрезки не летят', ticks2 === 0);
  ok('оба участника первой комнаты видят одно и то же',
     got.B.filter(m => m.type === 't' && m.seg).length === segs1);

  // Чужая команда в чужую комнату не проходит
  await post({ cid:'C2', room:r1, type:'stop' }); await wait(250);
  ok('посторонний не может остановить чужой раунд', last('A','round').running === true);

  await post({ cid:'A1', room:r1, type:'stop' }); await wait(250);
  ok('свой ведущий может', last('A','round').running === false);

  // Несуществующая комната
  const bad = await get(BASE + '/roster?room=' + encodeURIComponent('ЖЖЖЖ'));
  ok('несуществующая комната отвечает ошибкой', bad.error === 'no-room');

  A.destroy(); B.destroy(); C.destroy(); D.destroy();
  process.exit(0);
})();
