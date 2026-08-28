// Автопроверка. Запуск при работающем server.js:  node test.js
const http = require('http');
const BASE = 'http://localhost:3000';
const got = {};

function stream(tag, cid){
  got[tag] = [];
  return new Promise(resolve => {
    http.get(BASE + '/stream?cid=' + cid, res => {
      res.setEncoding('utf8');
      res.on('data', ch => ch.split('\n').forEach(l => {
        if (l.startsWith('data: ')) { try { got[tag].push(JSON.parse(l.slice(6))); } catch(e){} }
      }));
      resolve(res);
    });
  });
}
function post(body){
  return new Promise(resolve => {
    const d = JSON.stringify(body);
    const req = http.request(BASE + '/msg', { method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)} },
      res => { res.resume(); res.on('end', resolve); });
    req.end(d);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const last = (tag, type) => got[tag].filter(m => m.type === type).at(-1);
const ok = (l, c) => console.log((c ? 'OK   ' : 'СБОЙ ') + l);

(async () => {
  const A = await stream('A','A'); await wait(200);
  const B = await stream('B','B');
  const C = await stream('C','C'); await wait(400);

  // сервер мог остаться в середине прошлой партии — приводим в исходное
  // ведение забирает только следующий в очереди, поэтому просто убеждаемся в порядке
  await post({ cid:'A', type:'stop' });   await wait(200);
  await post({ cid:'A', type:'remode' }); await wait(300);

  // --- этапы --------------------------------------------------------------
  ok('партия начинается с выбора режима', last('A','you').stage === 'mode');
  ok('первый зашедший — ведущий', last('A','you').leader === true);
  ok('до лобби роли не раздаются', last('B','you').role === null);

  await post({ cid:'B', type:'mode', m:'noise' }); await wait(200);
  ok('не-ведущий не может выбрать режим', last('A','you').stage === 'mode');

  await post({ cid:'A', type:'mode', m:'mole' }); await wait(250);
  ok('после выбора режима — экран состава', last('A','you').stage === 'count');
  ok('режим разослан всем', last('C','you').mode === 'mole');

  await post({ cid:'A', type:'back' }); await wait(200);
  ok('кнопка «назад» возвращает к режиму', last('A','you').stage === 'mode');

  await post({ cid:'A', type:'mode', m:'mole' }); await wait(150);
  await post({ cid:'A', type:'count', n:3 });     await wait(250);
  ok('после состава — лобби', last('A','you').stage === 'lobby');
  ok('роли розданы в лобби', ['A','B','C'].every(t => last(t,'you').role));
  ok('состав применён', last('A','you').count === 3);

  // --- режим «Крот» -------------------------------------------------------
  await post({ cid:'A', type:'start' }); await wait(350);
  ok('раунд идёт', last('A','round').running === true);

  const tasks = ['A','B','C'].map(t => last(t,'round').task);
  const secrets = ['A','B','C'].map(t => last(t,'round').secret);
  const moles = secrets.filter(s => s === 'mole').length;
  ok('крот ровно один', moles === 1);
  const moleIx = secrets.indexOf('mole');
  const others = tasks.filter((_, i) => i !== moleIx);
  ok('у крота своё слово', tasks[moleIx] !== others[0]);
  ok('у остальных слово общее', others[0] === others[1]);

  await post({ cid:'A', type:'stop' }); await wait(300);
  const res = last('A','result');
  ok('итог вскрывает крота и его слово', !!res && !!res.secretRole && !!res.altTask);
  ok('после раунда — экран итога', last('A','you').stage === 'result');

  await post({ cid:'A', type:'again' }); await wait(250);
  ok('«ещё раунд» возвращает в лобби', last('A','you').stage === 'lobby');

  // --- режим «Проводник» --------------------------------------------------
  await post({ cid:'A', type:'remode' }); await wait(150);
  await post({ cid:'A', type:'mode', m:'guide' }); await wait(150);
  await post({ cid:'A', type:'count', n:3 });      await wait(200);
  await post({ cid:'A', type:'start' });           await wait(350);
  const gTasks = ['A','B','C'].map(t => last(t,'round').task);
  ok('слово видит ровно один', gTasks.filter(t => t).length === 1);
  ok('остальные не знают слова', gTasks.filter(t => t === null).length === 2);
  await post({ cid:'A', type:'stop' }); await wait(250);

  // --- режим «Помехи» -----------------------------------------------------
  await post({ cid:'A', type:'remode' }); await wait(150);
  await post({ cid:'A', type:'mode', m:'noise' }); await wait(150);
  await post({ cid:'A', type:'count', n:3 });      await wait(200);
  await post({ cid:'A', type:'start' });           await wait(300);
  ok('в «Помехах» слово видят все', ['A','B','C'].every(t => last(t,'round').task === last('A','round').task));

  // рисуем и проверяем, что холст едет
  const drawer = ['A','B','C'].find(t => last(t,'you').role === '3');
  const mover  = ['A','B','C'].find(t => last(t,'you').role === '1');
  await post({ cid:drawer, type:'input', action:'draw',  down:true });
  await post({ cid:mover,  type:'input', action:'right', down:true });
  await wait(500);
  const segs = got.A.filter(m => m.type === 't' && m.seg).length;
  ok('во время рисования идут отрезки', segs > 3);
  ok('у всех одинаковое число отрезков', got.B.filter(m => m.type === 't' && m.seg).length === segs);
  await post({ cid:drawer, type:'input', action:'draw', down:false });
  await post({ cid:mover,  type:'input', action:'right', down:false });

  console.log('\n     помехи приходят раз в 9–15 секунд, ждём одну…');
  await wait(16000);
  ok('помеха пришла', got.A.some(m => m.type === 'noise'));

  await post({ cid:'A', type:'stop' }); await wait(250);

  // --- уход ведущего ------------------------------------------------------
  A.destroy(); await wait(400);
  ok('ведущим стал следующий', last('B','you').leader === true);

  B.destroy(); C.destroy();
  process.exit(0);
})();
