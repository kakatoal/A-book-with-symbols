// ---------- 立体游乐场 ----------
// 点书页上的图形 → 它从纸面里长成立体的，可以复制、排列、旋转、换颜色，
// 右上角的大字会告诉你现在是什么组合。

// 书页上可以点的图形：面的序号（同 PAGES 的下标） → 图形和它在页面里的位置（比例）
const HOTSPOTS = {
  3: { shape: 'square', x: 0.5, y: 0.5, size: 0.19 },
  7: { shape: 'triangle', x: 0.5, y: 0.505, size: 0.21 },
  11: { shape: 'circle', x: 0.5, y: 0.5, size: 0.19 },
};

// 颜色都取自书里出现过的颜色
const PALETTE = [
  { name: 'black', hex: '#161616' },
  { name: 'red', hex: '#b25356' },
  { name: 'orange', hex: '#b86b08' },
  { name: 'blue', hex: '#1c2ca4' },
  { name: 'green', hex: '#3a9656' },
  { name: 'purple', hex: '#4c295a' },
  { name: 'gray', hex: '#8c8c8c' },
];

const SHAPES = {
  square: {
    name: 'square',
    solid: 'cube',
    geometry: () => new THREE.BoxGeometry(1, 1, 1),
  },
  triangle: {
    name: 'triangle',
    solid: 'pyramid',
    // 三条边的圆锥 = 三角锥；正面看过去就是一个三角形
    geometry: () => new THREE.ConeGeometry(0.72, 1.15, 3, 1, false, Math.PI / 2),
  },
  circle: {
    name: 'circle',
    solid: 'sphere',
    geometry: () => new THREE.SphereGeometry(0.62, 48, 32),
  },
};

// 排列方式：名字、说明，以及第 i 个（共 n 个）放在哪里
const LAYOUTS = [
  {
    id: 'repeat',
    title: 'Repetition',
    note: 'The same form, again and again, builds a rhythm.',
    place(i, n) {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const gap = 1.5;
      return {
        x: ((i % cols) - (cols - 1) / 2) * gap,
        y: ((rows - 1) / 2 - Math.floor(i / cols)) * gap,
        z: 0,
        s: 1,
        rz: 0,
      };
    },
  },
  {
    id: 'stack',
    title: 'Stack',
    note: 'Forms piled on top of each other gain height and weight.',
    place(i, n) {
      const step = 1.02;
      return { x: 0, y: (i - (n - 1) / 2) * step, z: 0, s: 1, rz: 0, ry: i * 0.18 };
    },
  },
  {
    id: 'radial',
    title: 'Radiation',
    note: 'Forms turning around one shared centre.',
    place(i, n) {
      const r = Math.max(1.5, n * 0.36);
      const a = (i / n) * Math.PI * 2 + Math.PI / 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0, s: 1, rz: a - Math.PI / 2 };
    },
  },
  {
    id: 'gradation',
    title: 'Gradation',
    note: 'The form changes step by step, little by little.',
    place(i, n) {
      const s = n === 1 ? 1 : 0.35 + (i / (n - 1)) * 0.85;
      // 把前面每一个的宽度累加起来，让它们一个挨一个
      let x = 0;
      for (let k = 0; k < i; k++) x += gradScale(k, n) * 1.15 + 0.2;
      let total = 0;
      for (let k = 0; k < n; k++) total += gradScale(k, n) * 1.15 + (k < n - 1 ? 0.2 : 0);
      return { x: x + (s * 1.15) / 2 - total / 2, y: 0, z: 0, s, rz: 0 };
    },
  },
];

function gradScale(i, n) {
  return n === 1 ? 1 : 0.35 + (i / (n - 1)) * 0.85;
}

const MAX_SHAPES = 16;

// ---------- 计分规则 ----------
const GAME_TIME = 10;            // 秒：开始时有多少时间
const TIME_BONUS = 0.3;          // 秒：每拼出一个新组合只加一点点时间
const TIME_CAP = 12;             // 秒：时间最多攒到这么多
const MULTIPLIERS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const STREAK_WINDOW = 1.6;       // 秒：这么久没拼出新组合，倍数往回掉一档
const BEST_KEY = 'symbol-book-best';

// 飘走：倍数越高，图形越想飞走；按空格拉回来
const DRIFT_FORCE = 4.5;   // 最乱时每秒加速多少
const HOLD_PULL = 0.55;    // 每按一下空格，偏移剩下多少（越小拉得越狠）
const DRIFT_WARN = 2.2;    // 飘这么远开始警告
const DRIFT_LOST = 4.2;    // 飘这么远就彻底飞走了

const game = {
  running: false,
  time: GAME_TIME,
  score: 0,
  step: 0,          // 当前倍数在 MULTIPLIERS 里的位置
  sinceScore: 0,    // 距离上次得分过了多久
  seen: new Set(),  // 已经拼出过的组合
  shake: 0,         // 镜头晃动
  ready: false,     // true = 规则卡还在，等玩家点"准备好了"
  clock: 0,
};

const play = {
  active: false,
  shape: null,
  layout: 0,
  spinning: false,
  meshes: [],
  origin: null, // 图形在书页上的位置（世界坐标），用来飞出 / 飞回
};

let renderer, camera, world, group, ground, raycaster;
const playEl = document.getElementById('play');
const playTitle = document.getElementById('playTitle');
const playTags = document.getElementById('playTags');
const playNote = document.getElementById('playNote');
const hud = {
  timer: document.getElementById('playTimer'),
  bar: document.getElementById('playTimebar'),
  score: document.getElementById('playScore'),
  mult: document.getElementById('playMult'),
  pop: document.getElementById('playPop'),
  ready: document.getElementById('playReady'),
  readyGo: document.getElementById('readyGo'),
  warn: document.getElementById('playWarn'),
  timeup: document.getElementById('playTimeup'),
  timeupScore: document.getElementById('timeupScore'),
  timeupTitle: document.querySelector('.timeup-title'),
  timeupBest: document.getElementById('timeupBest'),
};
const btn = {
  copy: document.getElementById('playCopy'),
  remove: document.getElementById('playRemove'),
  arrange: document.getElementById('playArrange'),
  spin: document.getElementById('playSpin'),
  hold: document.getElementById('playHold'),
  color: document.getElementById('playColor'),
  back: document.getElementById('playBack'),
};

// ---------- 书页上的热点 ----------
function addHotspots() {
  document.querySelectorAll('.leaf').forEach((leaf, leafIndex) => {
    leaf.querySelectorAll('.face').forEach((face) => {
      const faceIndex = leafIndex * 2 + (face.classList.contains('back') ? 1 : 0);
      const spot = HOTSPOTS[faceIndex];
      if (!spot) return;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `hotspot hotspot-${spot.shape}`;
      el.setAttribute('aria-label', `Play with the ${spot.shape}`);
      el.style.left = `${spot.x * 100}%`;
      el.style.top = `${spot.y * 100}%`;
      el.style.setProperty('--size', spot.size);
      el.dataset.shape = spot.shape;
      const best = document.createElement('span');
      best.className = 'hotspot-best';
      el.appendChild(best);
      el.addEventListener('click', (e) => {
        // 只有这一面正对着读者时才能玩，否则照常翻页
        const visible = face.classList.contains('back') ? leafIndex === flipped - 1 : leafIndex === flipped;
        if (book.dataset.state !== 'standing' || !visible) return;
        e.stopPropagation();
        enterPlay(spot.shape, el.getBoundingClientRect());
      });
      face.appendChild(el);
    });
  });
}

// ---------- Three.js 场景 ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('playCanvas').appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(0, 0, 10);

  world = new THREE.Scene();
  world.add(new THREE.AmbientLight(0xffffff, 0.62));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(4, 7, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  world.add(sun);

  group = new THREE.Group();
  world.add(group);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ opacity: 0.12 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  raycaster = new THREE.Raycaster();
  resize();
  window.addEventListener('resize', resize);
  bindPointer();
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// 屏幕上的一点 → z=0 平面上的世界坐标
function screenToWorld(x, y) {
  const v = new THREE.Vector3((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5);
  v.unproject(camera);
  const dir = v.sub(camera.position).normalize();
  const t = -camera.position.z / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(t));
}

function makeMesh(colorIndex) {
  const geo = SHAPES[play.shape].geometry();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: PALETTE[colorIndex].hex, roughness: 0.55, metalness: 0.05 })
  );
  mesh.castShadow = true;
  // 细细的墨线描边，呼应书里手绘的感觉（球没有棱，所以不会画出线）
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 25),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45 })
  );
  mesh.add(edges);
  mesh.userData = {
    color: colorIndex,
    spin: new THREE.Euler(),
    target: null,
    drift: new THREE.Vector3(), // 偏离原位多远
    vel: new THREE.Vector3(),   // 飘走的速度
    heading: Math.random() * Math.PI * 2, // 往哪个方向飘
  };
  group.add(mesh);
  play.meshes.push(mesh);
  return mesh;
}

// 按当前排列方式算出每个图形的目标位置
function arrange() {
  const n = play.meshes.length;
  const layout = LAYOUTS[play.layout];
  let extent = 1;
  play.meshes.forEach((m, i) => {
    const p = n === 1 ? { x: 0, y: 0, z: 0, s: 1.6, rz: 0 } : layout.place(i, n);
    m.userData.target = p;
    extent = Math.max(extent, Math.abs(p.x) + p.s, Math.abs(p.y) + p.s);
  });
  play.cameraZ = 5 + extent * 2.6;
  updateTitle();
}

// ---------- 右上角的组合名字 ----------
// 当前组合叫什么：标题（排列方式）+ 附加标签 + 说明
function comboName() {
  const n = play.meshes.length;
  const shape = SHAPES[play.shape];
  const colors = new Set(play.meshes.map((m) => m.userData.color));
  let title;
  let note;
  if (n === 1) {
    title = `A ${shape.name}`;
    note = `A flat ${shape.name} becomes a ${shape.solid}. Copy it to start composing.`;
  } else {
    title = LAYOUTS[play.layout].title;
    note = LAYOUTS[play.layout].note;
  }
  const tags = [];
  if (play.spinning) tags.push('Rotating');
  if (colors.size > 1) tags.push('Contrast');
  return { title, tags, note, n, colors: [...colors] };
}

function updateTitle() {
  scoreCombo();
  const { title, tags, note } = comboName();

  const text = `${title}|${tags.join(',')}`;
  if (playTitle.dataset.text === text) return;
  playTitle.dataset.text = text;
  playTitle.textContent = title;
  playTags.textContent = tags.map((t) => `+ ${t}`).join('  ');
  playNote.textContent = note;
  // 每次组合变化，字都重新冲进来
  const box = playTitle.parentElement;
  box.classList.remove('pop');
  void box.offsetWidth;
  box.classList.add('pop');
}

function updateButtons() {
  btn.arrange.textContent = `Arrange: ${LAYOUTS[play.layout].title}`;
  btn.spin.textContent = play.spinning ? 'Stop rotating' : 'Rotate';
  btn.remove.disabled = play.meshes.length <= 1;
  btn.copy.disabled = play.meshes.length >= MAX_SHAPES;
  btn.arrange.disabled = play.meshes.length <= 1;
}

// ---------- 进入 / 离开 ----------
function enterPlay(shape, rect) {
  if (!window.THREE) {
    console.warn('Three.js 没有加载成功（需要联网）');
    return;
  }
  if (!renderer) initThree();
  play.active = true;
  window.playMode = true;
  play.shape = shape;
  play.layout = 0;
  play.spinning = false;
  play.meshes.forEach((m) => group.remove(m));
  play.meshes = [];
  group.rotation.set(0, 0, 0);
  play.drag = { x: 0, y: 0, targetX: -0.32, targetY: 0.55 };

  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // 从书页上图形所在的位置、以纸一样扁的样子开始
  const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const edge = screenToWorld(rect.right, rect.top + rect.height / 2);
  const startScale = Math.max(0.2, (edge.x - center.x) * 2);
  play.origin = { pos: center, scale: startScale };

  const mesh = makeMesh(0);
  mesh.position.copy(center);
  mesh.scale.set(startScale, startScale, 0.02);

  arrange();
  updateButtons();
  startGame();
  playEl.classList.remove('leaving');
  playEl.hidden = false;
  requestAnimationFrame(() => playEl.classList.add('show'));
  scene.classList.add('playing');
  swarm(shape, 1);
  last = performance.now();
  requestAnimationFrame(loop);
}

function exitPlay() {
  if (!play.active || play.leaving) return;
  play.leaving = true;
  finishGame();
  play.meshes.forEach((m) => (m.userData.flyaway = false));
  // 所有图形缩回书页上那个平面图形里
  play.meshes.forEach((m) => {
    m.userData.target = {
      x: play.origin.pos.x, y: play.origin.pos.y, z: 0, s: play.origin.scale, flat: true, rz: 0,
    };
  });
  play.spinning = false;
  play.drag.targetX = 0;
  play.drag.targetY = 0;
  play.cameraZ = 10;

  // Persona 式退场：字和按钮先斜着甩出去，斜条扫过，
  // 图形飞回书页、压扁成纸上的图形，最后整层淡掉
  playEl.classList.add('leaving');
  playEl.classList.remove('show');
  scene.classList.remove('playing');
  swarm(play.shape, -1);
  setTimeout(() => {
    play.active = false;
    play.leaving = false;
    window.playMode = false;
    playEl.hidden = true;
    playEl.classList.remove('leaving');
    hud.timeup.hidden = true;
  }, EXIT_TIME);
}

const EXIT_TIME = 950; // 毫秒，和 style.css 里退场动画的总时长一致

// 转场：一群大小各不相同的蓝色同类图形（正方形 / 三角形 / 圆形）斜着冲过屏幕
// dir = 1 从左下往右上（进场），-1 从右上往左下（退场）
const swarmEl = document.getElementById('swarm');
const SWARM_COUNT = 26;

function swarm(shape, dir) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  swarmEl.textContent = '';
  for (let i = 0; i < SWARM_COUNT; i++) {
    const piece = document.createElement('span');
    const outline = Math.random() < 0.3; // 一部分是空心的描边款
    piece.className = `swarm-piece swarm-${shape}${outline ? ' outline' : ''}`;
    const size = 5 + Math.random() ** 1.6 * 30; // 大多数小，少数很大
    piece.style.setProperty('--size', `${size.toFixed(1)}vmin`);
    piece.style.setProperty('--c', 'var(--cover-blue)'); // 转场的图形统一用封面蓝
    piece.style.setProperty('--off', `${(Math.random() * 130 - 65).toFixed(1)}vh`);
    piece.style.setProperty('--dir', dir);
    piece.style.setProperty('--r0', `${Math.round(Math.random() * 360)}deg`);
    piece.style.setProperty('--spin', `${Math.round((Math.random() * 2 - 1) * 270)}deg`);
    piece.style.setProperty('--delay', `${(Math.random() * 0.28).toFixed(2)}s`);
    piece.style.setProperty('--dur', `${(0.45 + Math.random() * 0.3).toFixed(2)}s`);
    swarmEl.appendChild(piece);
  }
  clearTimeout(swarm.timer);
  swarm.timer = setTimeout(() => (swarmEl.textContent = ''), 1200);
}

// ---------- 动画循环 ----------
let last = 0;
function loop(now) {
  if (!play.active) return;
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  const k = 1 - Math.exp(-dt * 9); // 越大越快贴上目标
  tickGame(dt);
  const chaos = game.step / (MULTIPLIERS.length - 1); // 0 ~ 1，越玩越乱

  const drifting = game.running && chaos > 0;
  let worst = 0;
  play.meshes.forEach((m) => {
    const t = m.userData.target;
    if (!t) return;
    const d = m.userData.drift;
    const v = m.userData.vel;
    if (m.userData.flyaway && !play.leaving) {
      d.addScaledVector(v, dt * 2.5);
    } else if (drifting) {
      // 从中心往外扩散，带一点摇摆；越乱推得越猛
      const px = t.x + d.x;
      const py = t.y + d.y;
      if (Math.hypot(px, py) > 0.3) m.userData.heading = Math.atan2(py, px);
      m.userData.heading += (Math.random() - 0.5) * dt * 3;
      const force = DRIFT_FORCE * chaos ** 1.2 * dt;
      v.x += Math.cos(m.userData.heading) * force;
      v.y += Math.sin(m.userData.heading) * force;
      v.z += (Math.random() - 0.3) * force * 0.5;
      d.addScaledVector(v, dt);
      worst = Math.max(worst, d.length());
    } else if (!game.running) {
      d.multiplyScalar(1 - k);
      v.set(0, 0, 0);
    }
    m.position.x += (t.x + d.x - m.position.x) * k;
    m.position.y += (t.y + d.y - m.position.y) * k;
    m.position.z += (t.z + d.z - m.position.z) * k;
    const sz = t.flat ? 0.02 : t.s;
    m.scale.x += (t.s - m.scale.x) * k;
    m.scale.y += (t.s - m.scale.y) * k;
    m.scale.z += (sz - m.scale.z) * k;
    if (play.spinning) {
      m.userData.spin.x += dt * 0.7;
      m.userData.spin.y += dt * 1.3;
    } else {
      // 停下时转回最近的整圈，摆正
      const snap = (a) => Math.round(a / (Math.PI * 2)) * Math.PI * 2;
      m.userData.spin.x += (snap(m.userData.spin.x) - m.userData.spin.x) * k;
      m.userData.spin.y += (snap(m.userData.spin.y) - m.userData.spin.y) * k;
    }
    // 越乱抖得越厉害
    if (chaos > 0 && !play.leaving) {
      const seed = m.id * 1.7;
      m.position.x += Math.sin(game.clock * 23 + seed) * chaos * 0.035;
      m.position.y += Math.cos(game.clock * 19 + seed) * chaos * 0.035;
    }
    m.rotation.x = m.userData.spin.x;
    m.rotation.y = m.userData.spin.y + (t.ry || 0);
    m.rotation.z += ((t.rz || 0) - m.rotation.z) * k;
  });

  if (drifting) checkLost();
  hud.warn.hidden = !(drifting && worst > DRIFT_WARN);

  // 拖动视角
  group.rotation.x += (play.drag.targetX - group.rotation.x) * k;
  group.rotation.y += (play.drag.targetY - group.rotation.y) * k;

  camera.position.z += (play.cameraZ - camera.position.z) * k * 0.6;
  // 得分时镜头晃一下
  game.shake *= Math.exp(-dt * 8);
  camera.position.x = (Math.random() - 0.5) * game.shake;
  camera.position.y = (Math.random() - 0.5) * game.shake;
  camera.lookAt(0, 0, 0);

  // 地面放在所有图形的下方
  const box = new THREE.Box3().setFromObject(group);
  const floorY = box.isEmpty() ? -1 : box.min.y - 0.05;
  ground.position.y += (floorY - ground.position.y) * k;

  renderer.render(world, camera);
  requestAnimationFrame(loop);
}

// ---------- 计分游戏 ----------
// 当前组合的"指纹"：排列方式、数量、用了哪些颜色、有没有在转
function comboKey() {
  const n = play.meshes.length;
  const colors = [...new Set(play.meshes.map((m) => m.userData.color))].sort();
  return [n > 1 ? LAYOUTS[play.layout].id : 'single', n, colors.join('.'), play.spinning].join('|');
}

function startGame() {
  game.running = false;
  game.ready = true;
  game.time = GAME_TIME;
  game.maxTime = GAME_TIME;
  game.score = 0;
  game.step = 0;
  game.sinceScore = 0;
  game.shake = 0;
  game.clock = 0;
  game.seen = new Set([comboKey()]); // 一开始的样子不算分
  hud.timeup.hidden = true;
  logList.textContent = '';
  logCount.textContent = '0';
  playEl.classList.remove('hurry');
  setButtonsEnabled(false);
  // 规则卡被"甩"到屏幕上，落地时整个画面震一下
  hud.ready.classList.remove('leave');
  hud.ready.hidden = false;
  bump(hud.ready, 'show');
  playEl.classList.remove('impact');
  clearTimeout(go.impactTimer);
  go.impactTimer = setTimeout(() => bump(playEl, 'impact'), 380);
  renderHud();
}

// 倒数结束，正式开始计时
function go() {
  if (!game.ready) return;
  game.ready = false;
  game.running = true;
  game.seen = new Set([comboKey()]);
  // 规则卡被甩出屏幕
  hud.ready.classList.add('leave');
  clearTimeout(go.hideTimer);
  go.hideTimer = setTimeout(() => (hud.ready.hidden = true), 380);
  setButtonsEnabled(true);
  showPop('GO!');
}

function tickGame(dt) {
  game.clock += dt;
  if (game.ready) return; // 还在看规则，不计时
  if (!game.running) return;
  game.time = Math.max(0, game.time - dt);
  game.sinceScore += dt;
  // 停顿太久，倍数往回掉一档
  if (game.step > 0 && game.sinceScore > STREAK_WINDOW) {
    game.step--;
    game.sinceScore = STREAK_WINDOW * 0.5;
    bump(hud.mult);
  }
  playEl.classList.toggle('hurry', game.time <= 3);
  renderHud();
  if (game.time <= 0) timeUp();
}

function scoreCombo() {
  if (!game.running) return;
  const key = comboKey();
  if (game.seen.has(key)) return;
  game.seen.add(key);

  // 组合越复杂，基础分越高
  const n = play.meshes.length;
  const colors = new Set(play.meshes.map((m) => m.userData.color)).size;
  const base = 10 + n * 3 + (colors - 1) * 8 + (play.spinning ? 15 : 0) + (n > 1 ? 10 : 0);
  const mult = MULTIPLIERS[game.step];
  const points = Math.round(base * mult);
  game.score += points;
  game.step = Math.min(MULTIPLIERS.length - 1, game.step + 1);
  game.sinceScore = 0;
  game.shake = 0.08 + game.step * 0.03;

  logCombo(points, mult);
  bump(hud.score);
  bump(hud.mult);
  game.time = Math.min(TIME_CAP, game.time + TIME_BONUS);
  game.maxTime = Math.max(game.maxTime, game.time);
  bump(hud.timer);
  showPop(`+${points}  ×${mult}  +${TIME_BONUS}s`);
  renderHud();
}

// 把拼出来的组合记在左边的列表里，最新的在最上面
const logList = document.getElementById('logList');
const logCount = document.getElementById('logCount');

function logCombo(points, mult) {
  const { title, tags, n, colors } = comboName();
  const li = document.createElement('li');
  li.className = 'log-item';

  const chips = document.createElement('span');
  chips.className = 'log-chips';
  colors.forEach((c) => {
    const chip = document.createElement('i');
    chip.className = `chip chip-${play.shape}`;
    chip.style.setProperty('--c', PALETTE[c].hex);
    chips.appendChild(chip);
  });

  const name = document.createElement('span');
  name.className = 'log-name';
  name.textContent = [title, ...tags].join(' + ');

  const meta = document.createElement('span');
  meta.className = 'log-meta';
  meta.textContent = `${n} ${SHAPES[play.shape].name}${n > 1 ? 's' : ''} · +${points}${mult > 1 ? ` (×${mult})` : ''}`;

  li.append(chips, name, meta);
  logList.prepend(li);
  logCount.textContent = logList.children.length;
}

function renderHud() {
  hud.timer.textContent = game.time.toFixed(1);
  hud.bar.style.transform = `scaleX(${game.time / game.maxTime})`;
  hud.score.textContent = game.score;
  hud.mult.textContent = `×${MULTIPLIERS[game.step]}`;
}

// 重新触发一个 CSS 动画
function bump(el, cls = 'bump') {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function showPop(text) {
  hud.pop.textContent = text;
  hud.pop.style.setProperty('--pop-r', `${(Math.random() * 16 - 8).toFixed(1)}deg`);
  bump(hud.pop, 'show');
}

function timeUp() {
  const isRecord = finishGame();
  hud.timeupTitle.textContent = 'Time up!';
  hud.timeup.classList.remove('lose');
  hud.timeupScore.textContent = `${game.score}`;
  hud.timeupBest.textContent = isRecord ? 'New record!' : `Best ${loadBests()[play.shape] || 0}`;
  hud.timeup.hidden = false;
  bump(hud.timeup, 'show');
  setTimeout(exitPlay, 1600);
}

// 结束计时并保存最高分（save: false 时不保存）；返回是不是新纪录
function finishGame({ save = true } = {}) {
  game.ready = false;
  hud.ready.hidden = true;
  if (!game.running) return false;
  game.running = false;
  setButtonsEnabled(false);
  playEl.classList.remove('hurry');
  if (!save) return false;
  const bests = loadBests();
  const isRecord = game.score > (bests[play.shape] || 0);
  if (isRecord) {
    bests[play.shape] = game.score;
    saveBests(bests);
    refreshBests();
  }
  return isRecord;
}

function setButtonsEnabled(on) {
  Object.values(btn).forEach((b) => {
    if (b !== btn.back) b.classList.toggle('locked', !on);
  });
}

// 最高纪录存在这个浏览器里；存不了（比如隐私模式）也不影响玩
function loadBests() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveBests(bests) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(bests));
  } catch (e) {
    /* 忽略 */
  }
}

// 书页图形旁边显示最高纪录
function refreshBests() {
  const bests = loadBests();
  document.querySelectorAll('.hotspot').forEach((el) => {
    const best = bests[el.dataset.shape];
    const span = el.querySelector('.hotspot-best');
    span.textContent = best ? `Best ${best}` : '';
    span.hidden = !best;
  });
}

// ---------- 飘走 / 拉回 ----------
// 空格：把所有图形往回拉
function holdShapes() {
  if (!game.running) return;
  // 每按一下只拉回一部分，所以要一直连按
  play.meshes.forEach((m) => {
    m.userData.drift.multiplyScalar(HOLD_PULL);
    m.userData.vel.multiplyScalar(0.25);
  });
  game.shake = Math.max(game.shake, 0.06);
  bump(btn.hold);
}

// 有一个图形飘得太远 = 它飞走了 = 直接输掉
function checkLost() {
  const lost = play.meshes.find((m) => m.userData.drift.length() >= DRIFT_LOST);
  if (!lost) return;
  lost.userData.flyaway = true; // 让它继续飞出画面
  lost.userData.vel.multiplyScalar(3);
  game.shake = 0.4;
  gameOver();
}

function gameOver() {
  finishGame({ save: false }); // 输了不计入最高纪录
  hud.timeupTitle.textContent = 'It flew away!';
  hud.timeupScore.textContent = `${game.score}`;
  hud.timeupBest.textContent = 'You lose — score not counted';
  hud.timeup.classList.add('lose');
  hud.timeup.hidden = false;
  bump(hud.timeup, 'show');
  setTimeout(exitPlay, 2000);
}

// ---------- 操作 ----------
function copyShape() {
  if (!game.running) return;
  if (play.meshes.length >= MAX_SHAPES) return;
  const src = play.meshes[play.meshes.length - 1];
  const m = makeMesh(src.userData.color);
  // 从上一个图形里"分裂"出来
  m.position.copy(src.position);
  m.scale.copy(src.scale).multiplyScalar(0.6);
  m.userData.spin.copy(src.userData.spin);
  arrange();
  updateButtons();
}

function removeShape() {
  if (!game.running) return;
  if (play.meshes.length <= 1) return;
  const m = play.meshes.pop();
  group.remove(m);
  arrange();
  updateButtons();
}

function nextLayout() {
  if (!game.running) return;
  play.layout = (play.layout + 1) % LAYOUTS.length;
  arrange();
  updateButtons();
}

function toggleSpin() {
  if (!game.running) return;
  play.spinning = !play.spinning;
  updateTitle();
  updateButtons();
}

// 全部换成下一个颜色
function recolorAll() {
  if (!game.running) return;
  const next = (play.meshes[0].userData.color + 1) % PALETTE.length;
  play.meshes.forEach((m) => setColor(m, next));
  updateTitle();
}

function setColor(m, index) {
  m.userData.color = index;
  m.material.color.set(PALETTE[index].hex);
}

btn.copy.addEventListener('click', copyShape);
btn.remove.addEventListener('click', removeShape);
btn.arrange.addEventListener('click', nextLayout);
btn.spin.addEventListener('click', toggleSpin);
btn.color.addEventListener('click', recolorAll);
btn.back.addEventListener('click', exitPlay);
btn.hold.addEventListener('click', holdShapes);
hud.readyGo.addEventListener('click', (e) => {
  e.currentTarget.blur();
  go();
});
// 点完按钮马上取消焦点，免得按空格时又"点"了一次按钮
document.querySelector('.play-tools').addEventListener('click', (e) => {
  if (e.target.closest('button')) e.target.closest('button').blur();
});

document.addEventListener('keydown', (e) => {
  if (!play.active) return;
  if (e.code === 'Space' || (e.key === 'Enter' && game.ready)) {
    e.preventDefault();
    if (e.repeat) return;
    if (game.ready) go(); // 规则卡上：空格 / 回车 = 准备好了
    else holdShapes();
    return;
  }
  if (e.key === 'Escape') exitPlay();
  if (e.key === '+' || e.key === '=') copyShape();
  if (e.key === '-') removeShape();
  if (e.key.toLowerCase() === 'r') toggleSpin();
  if (e.key.toLowerCase() === 'c') recolorAll();
  if (e.key.toLowerCase() === 'a') nextLayout();
});

// 拖动转视角；不拖动直接点某个图形，就只给它换颜色
function bindPointer() {
  const el = renderer.domElement;
  let down = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, rx: play.drag.targetX, ry: play.drag.targetY, moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) down.moved = true;
    play.drag.targetY = down.ry + dx * 0.008;
    play.drag.targetX = Math.max(-1.3, Math.min(1.3, down.rx + dy * 0.008));
  });
  el.addEventListener('pointerup', (e) => {
    if (down && !down.moved) {
      const p = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(p, camera);
      const hit = raycaster.intersectObjects(play.meshes, false)[0];
      if (hit && game.running) {
        setColor(hit.object, (hit.object.userData.color + 1) % PALETTE.length);
        updateTitle();
      }
    }
    down = null;
  });
}

addHotspots();
refreshBests();
