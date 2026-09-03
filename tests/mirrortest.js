// Проверка зеркала и переезда кляксы в помехи.
// Запуск при работающем сервере:  node mirrortest.js
const http=require('http'); const BASE='http://localhost:3000'; const got={}; let ROOM=null;
function stream(t,cid){got[t]=[];return new Promise(r=>{http.get(BASE+'/stream?cid='+cid+'&room='+encodeURIComponent(ROOM),res=>{res.setEncoding('utf8');
res.on('data',ch=>ch.split('\n').forEach(l=>{if(l.startsWith('data: ')){try{got[t].push(JSON.parse(l.slice(6)))}catch(e){}}}));r(res);});});}
function post(b){return new Promise(r=>{const d=JSON.stringify({...b,room:ROOM});const q=http.request(BASE+'/msg',{method:'POST',
headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)}},res=>{res.resume();res.on('end',r);});q.end(d);});}
const newRoom = () => new Promise(r => http.get(BASE+'/new', res => {
  let s=''; res.on('data',d=>s+=d); res.on('end',()=>r(JSON.parse(s).room));
}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const last=(t,ty)=>got[t].filter(m=>m.type===ty).at(-1);
const ok=(l,c)=>console.log((c?'OK   ':'СБОЙ ')+l);
const W=1800;
(async()=>{
  ROOM = await newRoom();
  const A=await stream('A','MA'); await wait(200);
  const B=await stream('B','MB'); const C=await stream('C','MC'); const D=await stream('D','MD'); await wait(400);
  await post({cid:'MA',type:'claim'}); await wait(150);
  await post({cid:'MA',type:'stop'}); await wait(150);
  await post({cid:'MA',type:'remode'}); await wait(200);
  await post({cid:'MA',type:'mode',m:'free'}); await wait(150);
  await post({cid:'MA',type:'count',n:4}); await wait(250);
  await post({cid:'MA',type:'start'}); await wait(300);

  const who=r=>'M'+['A','B','C','D'].find(t=>last(t,'you').role===r);
  const mover=who('1'), drawer=who('3'), styler=who('4');
  ok('роли розданы', !!mover && !!drawer && !!styler);
    ok('у стиля есть запас зеркала', last('A','round').left.mirror===2);
  ok('кляксы в запасах нет', last('A','round').left.blob===undefined);

  // рисуем без зеркала
  await post({cid:drawer,type:'input',action:'draw',down:true});
  await post({cid:mover,type:'input',action:'right',down:true});
  await wait(400);
  const plain=got.A.filter(m=>m.type==='t'&&m.seg).length;
  const mirrored0=got.A.filter(m=>m.type==='t'&&m.mseg).length;
  ok('обычные отрезки идут', plain>3);
  ok('без зеркала отражений нет', mirrored0===0);

  // включаем зеркало
  await post({cid:styler,type:'input',action:'mirror',down:true}); await wait(400);
  const t=got.A.filter(m=>m.type==='t'&&m.mseg).at(-1);
  ok('появились зеркальные отрезки', !!t);
  ok('отражение по вертикальной оси', !!t && Math.abs((t.seg.b[0]+t.mseg.b[0])-W)<1.5);
  ok('высота совпадает', !!t && Math.abs(t.seg.b[1]-t.mseg.b[1])<1.5);
  ok('запас уменьшился до 1', last('A','round').left.mirror===1);
  ok('признак зеркала разослан', t.m===1);

  // удержание не тратит второй раз
  await wait(400);
  ok('пока держат, запас не тратится', last('A','round').left.mirror===1);

  await post({cid:styler,type:'input',action:'mirror',down:false}); await wait(250);
  await post({cid:styler,type:'input',action:'mirror',down:true}); await wait(250);
  ok('повторное включение тратит вторую попытку', last('A','round').left.mirror===0);
  await post({cid:styler,type:'input',action:'mirror',down:false}); await wait(200);
  await post({cid:styler,type:'input',action:'mirror',down:true}); await wait(300);
  ok('третье включение не срабатывает', got.A.filter(m=>m.type==='t').at(-1).m===0);

  await post({cid:drawer,type:'input',action:'draw',down:false});
  await post({cid:mover,type:'input',action:'right',down:false});
  await post({cid:'MA',type:'stop'}); await wait(250);
  A.destroy();B.destroy();C.destroy();D.destroy();process.exit(0);
})();
