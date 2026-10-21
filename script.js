// ---------- 书页内容 ----------
// 按顺序填写每一面的图片路径；null 表示空白纸页。
// 书里用的是 images/web/ 里的小尺寸版本（1400 像素高），iPad 上更省显存；
// 换了原图后，运行 python tools/make-web-images.py 重新生成。
// 每两面组成一张纸：正面在右页，背面在左页。
// [0] 封面, [1] 封面内侧 ... 倒数第二面是封底内侧，最后一面是封底。
const PAGES = [
  'images/web/cover.jpg',    // 封面
  null,                  // 封面内侧（左）
  'images/web/0.jpg',  // 右：Methodology
  'images/web/1.jpg',  // 左：A Square
  'images/web/2.jpg',  // 右
  'images/web/3.jpg',  // 左
  'images/web/4.jpg',  // 右
  'images/web/5.jpg',  // 左：A Triangle
  'images/web/6.jpg',  // 右
  'images/web/7.jpg',  // 左
  'images/web/8.jpg',  // 右
  'images/web/9.jpg',  // 左：A Circle
  'images/web/10.jpg', // 右
  'images/web/11.jpg', // 左
  'images/web/12.jpg', // 右（封底内侧）
  'images/web/cover.jpg',    // 封底（和封面一样）
];

// 封面图片：也用来生成封面板边缘和书脊的纹理
const COVER_IMAGE = 'images/web/cover.jpg';

// 厚度（相对书页高度的比例）
const BOOK_THICKNESS = 0.05;   // 整本书的厚度
const COVER_THICKNESS = 0.007; // 封面 / 封底硬板的厚度

// 拿起书后跟随鼠标的偏移幅度
const TILT_ROTATE_X = 7;   // 上下倾斜（度）
const TILT_ROTATE_Y = 10;  // 左右倾斜（度）
const TILT_MOVE = 14;      // 平移（px）
const TILT_EASE = 0.08;    // 跟随速度，越小越柔和

const scene = document.getElementById('scene');
const pose = document.getElementById('pose');
const book = document.getElementById('book');
const tilt = document.getElementById('tilt');
const hint = document.getElementById('hint');
const label = document.getElementById('label');
const layDownBtn = document.getElementById('layDown');

const leaves = [];
let glareEl = null;
const blocks = {};
let leafThickness = []; // 每张纸的厚度（px）
let flipped = 0; // 已经翻过去的纸张数

function createFace(src, side, index) {
  const face = document.createElement('div');
  face.className = `face ${side}`;
  const isOuterCover = index === 0 || index === Math.ceil(PAGES.length / 2) * 2 - 1;
  if (!src && isOuterCover) {
    face.classList.add('board-blank');
  } else if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Page ${index}`;
    img.draggable = false;
    face.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    face.appendChild(ph);
  }
  return face;
}

// 书块：一摞纸的侧面（外侧切口、书脊、顶部、底部）
function createBlock(side) {
  const block = document.createElement('div');
  block.className = `block block-${side}`;
  ['fore', 'spine', 'top', 'bottom'].forEach((name) => {
    const edge = document.createElement('div');
    edge.className = `edge edge-${name}`;
    edge.innerHTML = '<div class="board board-bottom"></div><div class="paper"></div><div class="board board-top"></div>';
    block.appendChild(edge);
  });
  book.appendChild(block);
  return block;
}

// 根据当前书页大小计算每张纸的厚度
function measure() {
  const n = leaves.length;
  const pageH = book.offsetHeight;
  const coverT = Math.max(2, pageH * COVER_THICKNESS);
  const innerT = n > 2 ? Math.max(0, pageH * BOOK_THICKNESS - 2 * coverT) / (n - 2) : 0;
  leafThickness = leaves.map((_, i) => (i === 0 || i === n - 1 ? coverT : innerT));
  book.style.setProperty('--cover-t', `${coverT}px`);
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function buildBook() {
  book.style.setProperty('--cover-img', `url("${COVER_IMAGE}")`);
  blocks.left = createBlock('left');
  blocks.right = createBlock('right');
  const gutter = document.createElement('div');
  gutter.className = 'gutter';
  book.appendChild(gutter);

  const leafCount = Math.ceil(PAGES.length / 2);
  for (let i = 0; i < leafCount; i++) {
    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    if (i === 0 || i === leafCount - 1) leaf.classList.add('cover');
    if (i === 0) leaf.classList.add('front-cover');
    leaf.appendChild(createFace(PAGES[i * 2], 'front', i * 2));
    leaf.appendChild(createFace(PAGES[i * 2 + 1], 'back', i * 2 + 1));
    if (i === 0) {
      // 封面上那道细细的反光带
      glareEl = document.createElement('div');
      glareEl.className = 'glare';
      leaf.querySelector('.face.front').appendChild(glareEl);
    }
    leaf.addEventListener('click', (e) => {
      if (book.dataset.state !== 'standing') return;
      e.stopPropagation();
      i < flipped ? prev() : next();
    });
    book.appendChild(leaf);
    leaves.push(leaf);
  }
  renderInstantly();
}

// 不带动画地摆好书页（加载时和改变窗口大小时用，避免封面从书里升上来）
function renderInstantly() {
  book.classList.add('no-anim');
  measure();
  render();
  book.offsetHeight; // 强制浏览器先应用这次布局
  requestAnimationFrame(() => book.classList.remove('no-anim'));
}

let lastFlipped = 0;

function render() {
  const n = leaves.length;
  // 一次翻了好几页（比如合书）时，两侧厚度跟着整段动画平滑变化
  const manyAtOnce = Math.abs(flipped - lastFlipped) > 1;
  // 只显示每一摞最上面那张纸（和正在翻动的纸），被压在下面的纸隐藏掉。
  // iPad 上的 Safari 给一层层很薄的 3D 平面排序时会出错，
  // 下面的纸会突然"跳"到上面来乱闪；藏起来就不会被画错。
  const lo = Math.min(lastFlipped, flipped) - 1;
  const hi = Math.max(lastFlipped, flipped);
  lastFlipped = flipped;
  leaves.forEach((leaf, i) => leaf.classList.toggle('buried', i < lo || i > hi));
  clearTimeout(render.buryTimer);
  render.buryTimer = setTimeout(buryHiddenLeaves, cssTime('--flip-time') + 50);
  leaves.forEach((leaf, i) => {
    const isFlipped = i < flipped;
    // 每张纸放在它所在那一摞的对应高度上：
    // 右边一摞从封底往上叠，左边一摞从封面往上叠
    const z = isFlipped
      ? sum(leafThickness.slice(0, i + 1))
      : sum(leafThickness.slice(i));
    leaf.style.transform = `translateZ(${z}px) rotateY(${isFlipped ? -180 : 0}deg)`;
  });

  // 两摞纸的侧面厚度
  const leftD = sum(leafThickness.slice(0, flipped));
  const rightD = sum(leafThickness.slice(flipped));
  updateBlock(blocks.left, leftD, flipped > 0, flipped === n, manyAtOnce);
  updateBlock(blocks.right, rightD, flipped < n, flipped === 0, manyAtOnce);
  book.classList.toggle('open', flipped > 0 && flipped < n);

  // 合上（封面朝上）居中；翻开时书脊居中；全部翻完（封底朝上）也居中
  let shift = '0px';
  if (flipped > 0 && flipped < n) shift = 'calc(var(--page-w) / 2)';
  if (flipped === n) shift = 'var(--page-w)';
  book.style.setProperty('--shift', shift);
  book.style.setProperty('--lie-shift', flipped === n ? 'var(--page-w)' : '0px');

  // 合着的时候稍微侧转，露出书的厚度
  let turn = '0deg';
  if (flipped === 0) turn = '-24deg';
  if (flipped === n) turn = '24deg';
  book.style.setProperty('--turn', turn);

  // 旋转中心：合上时是封面中心，翻开时是书脊，翻到封底时是封底中心
  let origin = '50%';
  if (flipped > 0 && flipped < n) origin = '0%';
  if (flipped === n) origin = '-50%';
  book.style.setProperty('--origin-x', origin);

  // 文字跟着书的左边缘：翻开时书向左多出半页
  pose.style.setProperty('--label-x', flipped > 0 && flipped < n ? 'calc(var(--page-w) / -2)' : '0px');
}

// 翻页动画结束后，只留两摞最上面的那两张纸
function buryHiddenLeaves() {
  leaves.forEach((leaf, i) => leaf.classList.toggle('buried', i !== flipped - 1 && i !== flipped));
}

function updateBlock(block, depth, hasBottomBoard, hasTopBoard, smooth) {
  const prev = parseFloat(block.style.getPropertyValue('--d')) || 0;
  const flip = cssTime('--flip-time');
  if (smooth) {
    block.style.setProperty('--edge-delay', '0ms');
    block.style.setProperty('--edge-dur', `${flip}ms`);
  } else if (depth > prev) {
    // 变厚：等翻过来的纸快落下时再长出来
    block.style.setProperty('--edge-delay', `${flip * 0.75}ms`);
    block.style.setProperty('--edge-dur', `${flip * 0.25}ms`);
  } else {
    // 变薄：纸一离开就收薄
    block.style.setProperty('--edge-delay', '0ms');
    block.style.setProperty('--edge-dur', `${flip * 0.25}ms`);
  }
  block.style.setProperty('--d', `${depth}px`);
  block.classList.toggle('no-bottom', !hasBottomBoard);
  block.classList.toggle('no-top', !hasTopBoard);
}

// 读取 CSS 里的时长变量（如 "0.9s"），换成毫秒
function cssTime(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000 || 0;
}

function next() {
  if (closing) return;
  if (flipped < leaves.length) {
    flipped++;
    render();
  }
}

function prev() {
  if (closing) return;
  if (flipped > 0) {
    flipped--;
    render();
  }
}

// ---------- 文字 ----------
const TEXT = {
  lying: 'Pick me up!',
  standing: 'Click a page\nto turn',
  layDown: 'Put it down',
};

function setState(state) {
  endIntro();
  pose.dataset.state = state;
  book.dataset.state = state;
  popLabel();
}

// 每次拿起 / 放下书，文字都重新冲进来一次
function popLabel() {
  label.classList.remove('pop');
  void label.offsetWidth; // 重新触发动画
  label.classList.add('pop');
}

// ---------- 入场动画 ----------
// 动画结束（或者提前点击）后去掉 intro，交回给正常的姿态切换
function endIntro() {
  scene.classList.remove('intro');
}

label.addEventListener('animationend', (e) => {
  if (e.animationName === 'label-in') endIntro();
});

function standUp() {
  setState('standing');
  scene.classList.add('standing');
  layDownBtn.hidden = false;
  hint.textContent = TEXT.standing;
}

// 放下书：
// - 合着的（封面朝上或封底朝上）：直接放平，封底朝上就背面朝上放下，不用翻回去
// - 翻开在中间：先合到离得近的那一面，合好了再放平
//   （两个动作同时做的话，书页会一边翻一边被放倒，穿过书本和地面）
let closing = false;

function layDown() {
  if (closing) return;
  const n = leaves.length;
  if (flipped > 0 && flipped < n) {
    closing = true;
    flipped = flipped >= n / 2 ? n : 0;
    render();
    setTimeout(() => {
      closing = false;
      putDown();
    }, cssTime('--flip-time') + 80);
    return;
  }
  putDown();
}

function putDown() {
  setState('lying');
  scene.classList.remove('standing');
  layDownBtn.hidden = true;
  hint.textContent = TEXT.lying;
}

pose.addEventListener('click', () => {
  if (book.dataset.state === 'lying') standUp();
});

layDownBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  layDown();
});

hint.textContent = TEXT.lying;
layDownBtn.textContent = TEXT.layDown;

document.addEventListener('keydown', (e) => {
  if (window.playMode) return; // 正在玩立体图形时，键盘交给 play.js
  if (book.dataset.state !== 'standing') {
    if (e.key === 'Enter' || e.key === ' ') standUp();
    return;
  }
  if (e.key === 'ArrowRight') next();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'Escape') layDown();
});

// ---------- 跟随鼠标偏移 ----------
const pointer = { x: 0, y: 0 }; // 鼠标位置，-1 ~ 1
const current = { x: 0, y: 0 };
const glare = { x: 0 };         // 封面高光带的位置

document.addEventListener('mousemove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
});

document.addEventListener('mouseleave', () => {
  pointer.x = 0;
  pointer.y = 0;
});

let lastTiltKey = '';

function animateTilt() {
  const active = book.dataset.state === 'standing';
  const targetX = active ? pointer.x : 0;
  const targetY = active ? pointer.y : 0;
  current.x += (targetX - current.x) * TILT_EASE;
  current.y += (targetY - current.y) * TILT_EASE;
  glare.x += (targetX - glare.x) * TILT_EASE;

  // 只有真的在动时才更新：一直改 transform 会让 Safari 每帧重新给 3D 图层排序
  const key = `${current.x.toFixed(4)},${current.y.toFixed(4)},${glare.x.toFixed(4)}`;
  if (key !== lastTiltKey) {
    lastTiltKey = key;
    tilt.style.transform =
      `translate(${current.x * TILT_MOVE}px, ${current.y * TILT_MOVE}px) ` +
      `rotateX(${-current.y * TILT_ROTATE_X}deg) rotateY(${current.x * TILT_ROTATE_Y}deg)`;
    // 反光带跟着鼠标左右移动（只移动反光这一层，不让整本书重新算样式）
    if (glareEl) glareEl.style.transform = `translateX(${glare.x * 22.5}%)`;
  }
  requestAnimationFrame(animateTilt);
}

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  requestAnimationFrame(animateTilt);
}

window.addEventListener('resize', renderInstantly);

buildBook();
