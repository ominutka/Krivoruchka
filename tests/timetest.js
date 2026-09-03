// Проверка выбора длительности раунда.
// Запуск при работающем сервере:  node timetest.js
const http=require('http'); const BASE='http://localhost:3000'; const got={}; let ROOM=null;
const newRoom=()=>new Promise(r=>http.get(BASE+'/new',res=>{let s='';res.on('data',d=>s+=d);res.on('end',()=>r(JSON.parse(s).room));}));
function stream(t,cid){got[t]=[];return new Promise(r=>{http.get(BASE+'/stream?cid='+cid+'&room='+ROOM,res=>{res.setEncoding('utf8');
res.on('data',ch=>ch.split('\n').forEach(l=>{if(l.startsWith('data: ')){try{got[t].push(JSON.parse(l.slice(6)))}catch(e){}}}));r(res);});});}
function post(b){return new Promise(r=>{const d=JSON.stringify({...b,room:ROOM});const q=http.request(BASE+'/msg',{method:'POST',
headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)}},res=>{res.resume();res.on('end',r);});q.end(d);});}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const last=(t,ty)=>got[t].filter(m=>m.type===ty).at(-1);
const ok=(l,c)=>console.log((c?'OK   ':'СБОЙ ')+l);
(async()=>{
  ROOM=await newRoom();
  const A=await stream('A','A'); await wait(150);
  const B=await stream('B','B'); await wait(400);

  ok('по умолчанию раунд длиннее минуты', last('A','you').secs === 90);
  ok('варианты присланы клиенту', Array.isArray(last('A','roster').secsOptions));
  ok('таймер до старта показывает выбранное', last('A','round').secs === 90);

  await post({cid:'A',type:'mode',m:'free'}); await wait(200);
  await post({cid:'A',type:'count',n:2});     await wait(250);

  await post({cid:'B',type:'time',n:180}); await wait(250);
  ok('не-ведущий не меняет время', last('A','you').secs === 90);

  await post({cid:'A',type:'time',n:180}); await wait(300);
  ok('ведущий поменял на три минуты', last('A','you').secs === 180);
  ok('второй игрок это видит', last('B','you').secs === 180);

  await post({cid:'A',type:'time',n:45}); await wait(250);
  ok('произвольное значение отклонено', last('A','you').secs === 180);

  await post({cid:'A',type:'start'}); await wait(400);
  const t=got.A.filter(m=>m.type==='t').at(-1);
  ok('раунд стартовал с выбранным временем', t && t.s > 170);

  await post({cid:'A',type:'time',n:60}); await wait(250);
  ok('во время раунда время не меняется', last('A','you').secs === 180);

  await post({cid:'A',type:'stop'}); await wait(250);
  A.destroy(); B.destroy(); process.exit(0);
})();
