// Наборы ролей для разного числа игроков.
//
// Главный принцип: движение делится не по осям, а по диагоналям.
// Один человек владеет «вправо» и «вниз», другой — «влево» и «вверх».
// Прямую линию не проведёт никто в одиночку.
//
// Второй принцип: действие, которое человек выполняет сам по себе, игре
// не нужно — оно выпадает из логики. Поэтому клякса ушла в помехи,
// а её место занял «Зеркало»: оно даёт симметрию, которой иначе не добиться.

(function(global){

  const B = {
    right: {a:'right', g:'→', t:'Вправо'},
    down:  {a:'down',  g:'↓', t:'Вниз'},
    left:  {a:'left',  g:'←', t:'Влево'},
    up:    {a:'up',    g:'↑', t:'Вверх'},

    draw:  {a:'draw',  g:'✎', t:'Рисовать', h:'держите'},
    erase: {a:'erase', g:'⌫', t:'Стереть',  h:'держите'},

    stamp: {a:'stamp', g:'✦', t:'Штамп',  tap:true, c:'stamp'},
    shake: {a:'shake', g:'∿', t:'Тряска', tap:true, c:'shake'},

    thin:  {a:'thin',  g:'—', t:'Тоньше', h:'держите'},
    thick: {a:'thick', g:'▬', t:'Толще',  h:'держите'},
    color: {a:'color', g:'',  t:'Сменить цвет', tap:true, swatch:true},
    // Зеркало: пока держат, всё рисуется сразу и в отражении.
    // Ограничено двумя включениями за раунд.
    mirror:{a:'mirror',g:'⧉', t:'Зеркало', c:'mirror'},

    slow:  {a:'slow',  g:'🐢', t:'Медленно', h:'держите'},
    fast:  {a:'fast',  g:'🐇', t:'Быстро',   h:'держите'}
  };

  const NE = [B.right, B.down];
  const SW = [B.left,  B.up];
  const STYLE = [[B.thin, B.thick],[B.color, B.mirror]];

  const ROLESETS = {
    2: [
      { title:'Вправо, вниз и карандаш',
        sub:'Тянет в свою сторону и рисует',
        rows:[NE, [B.draw]] },
      { title:'Влево, вверх и ластик',
        sub:'Тянет в свою сторону и стирает',
        rows:[SW, [B.erase]] }
    ],

    3: [
      { title:'Вправо и вниз', sub:'Половина движения. Вторая у другого человека', rows:[NE] },
      { title:'Влево и вверх', sub:'Половина движения. Вторая у другого человека', rows:[SW] },
      { title:'Карандаш и ластик', sub:'Единственный, кто оставляет след и убирает его',
        rows:[[B.draw],[B.erase]] }
    ],

    4: [
      { title:'Вправо и вниз', sub:'Половина движения', rows:[NE] },
      { title:'Влево и вверх', sub:'Половина движения', rows:[SW] },
      { title:'Карандаш и ластик', sub:'Рисует и стирает', rows:[[B.draw],[B.erase]] },
      { title:'Стиль и зеркало', sub:'Толщина, цвет и симметрия — 2 включения за раунд', rows:STYLE }
    ],

    5: [
      { title:'Вправо и вниз',   sub:'Половина движения', rows:[NE] },
      { title:'Влево и вверх',   sub:'Половина движения', rows:[SW] },
      { title:'Карандаш',        sub:'Единственный, кто оставляет след', rows:[[B.draw]] },
      { title:'Ластик и штампы', sub:'Стирает чужое и вбивает фигуры', rows:[[B.erase],[B.stamp]] },
      { title:'Стиль и зеркало', sub:'Толщина, цвет и симметрия — 2 включения за раунд', rows:STYLE }
    ],

    6: [
      { title:'Вправо и вниз',   sub:'Половина движения', rows:[NE] },
      { title:'Влево и вверх',   sub:'Половина движения', rows:[SW] },
      { title:'Карандаш',        sub:'Единственный, кто оставляет след', rows:[[B.draw]] },
      { title:'Ластик и штампы', sub:'Стирает чужое и вбивает фигуры', rows:[[B.erase],[B.stamp]] },
      { title:'Стиль и зеркало', sub:'Толщина, цвет и симметрия — 2 включения за раунд', rows:STYLE },
      { title:'Скорость и тряска', sub:'Разгоняет, тормозит и трясёт карандаш',
        rows:[[B.slow, B.fast],[B.shake]] }
    ]
  };

  const COLORS = ['--p1','--p2','--p3','--p4','--p5','--p6'];

  function roles(count){
    const set = ROLESETS[count] || ROLESETS[4];
    return set.map((r, i) => ({
      id: String(i + 1),
      title: r.title,
      subtitle: r.sub || '',
      color: 'var(' + COLORS[i] + ')',
      rows: r.rows
    }));
  }

  function ownerOf(count){
    const map = {};
    roles(count).forEach(r => r.rows.forEach(row => row.forEach(b => { map[b.a] = r.id; })));
    return map;
  }

  global.KR = { roles, ownerOf, MIN:2, MAX:6 };

})(typeof window !== 'undefined' ? window : globalThis);
