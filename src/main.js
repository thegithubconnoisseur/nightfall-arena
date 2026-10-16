import { START_NG, getCurrentUser, onUserChange, signIn, guestStyle } from './platform.js';
import { normalizeStyle } from './character.js';
import { Game } from './game.js';
import { playerId, submitRun, leaderboard } from './saves.js';

const $ = (id) => document.getElementById(id);

const canvas = $('scene');
const hud = $('hud');
const menuScreen = $('screenMenu');
const overScreen = $('screenOver');

// start.ng sends ?guest when the player already chose guest on its homepage.
const openedAsGuest = new URLSearchParams(location.search).has('guest');

const game = new Game(canvas);

let user = null;
let style = normalizeStyle(null);
let running = false;
let lastBannerKey = -1;
let lastHudAt = 0;
let lastFlasks = -1;

// ------------------------------------------------------------------ screens

function showMenu() {
  menuScreen.hidden = false;
  overScreen.hidden = true;
  hud.hidden = true;
}

function showHud() {
  menuScreen.hidden = true;
  overScreen.hidden = true;
  hud.hidden = false;
}

// ----------------------------------------------------------------- identity

function swatches(style) {
  return [style.primaryColor, style.secondaryColor, style.skinColor]
    .map((c) => `<i class="swatch" style="background:${c}"></i>`)
    .join('');
}

function renderIdentity() {
  const box = $('identity');
  const buttons = $('menuButtons');
  const note = $('menuNote');
  buttons.innerHTML = '';

  const button = (label, onClick, kind = '') => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `btn ${kind}`.trim();
    el.textContent = label;
    el.addEventListener('click', onClick);
    buttons.append(el);
  };

  if (START_NG === null) {
    // Somewhere other than start.ng: no sign-in is possible at all.
    box.innerHTML = '<p class="who">Playing as <b>Guest</b></p>';
    note.textContent = 'Sign-in isn’t available here — this copy isn’t running on start.ng, so you play as a guest.';
    button('Enter the arena', startRun, 'primary');
    return;
  }

  if (user) {
    const name = user.name || 'nameless one';
    box.innerHTML = `<p class="who">Welcome, <b>${escapeHtml(name)}</b></p>
      <p class="look">${swatches(style)} <span>${style.hat} · ${style.accessory}</span></p>`;
    note.textContent = 'Your start.ng colours are on your armour, and your hat and accessory are on your head and back.';
    button('Enter the arena', startRun, 'primary');
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'btn link';
    out.textContent = 'Sign out on start.ng';
    out.addEventListener('click', () => {
      location.href = `${START_NG}/`;
    });
    buttons.append(out);
    return;
  }

  box.innerHTML = '<p class="who">Playing as <b>Guest</b></p>';
  if (openedAsGuest) {
    // The player already picked guest on start.ng, so don't ask again.
    note.textContent = 'Playing as a guest. Sign in any time to wear your own colours.';
    button('Enter the arena', startRun, 'primary');
    button('Sign in with start.ng', () => signIn());
    return;
  }
  note.textContent = 'Sign in to put your own colours, hat and accessory on your character.';
  button('Sign in with start.ng', () => signIn(), 'primary');
  button('Play as guest', startRun);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// -------------------------------------------------------------- leaderboard

function renderBoards() {
  const rows = leaderboard(5);
  const mine = playerId(user);
  const html = rows
    .map(
      (row, i) =>
        `<li class="${row.id === mine ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="pname">${escapeHtml(row.name)}</span><span class="pscore">${row.best.toLocaleString()}</span></li>`,
    )
    .join('');

  for (const listId of ['boardList', 'overBoardList']) {
    const list = $(listId);
    if (list) list.innerHTML = html;
  }
  for (const emptyId of ['boardEmpty', 'overBoardEmpty']) {
    const el = $(emptyId);
    if (el) el.hidden = rows.length > 0;
  }
}

// ---------------------------------------------------------------- run flow

function startRun() {
  showHud();
  lastBannerKey = -1;
  lastFlasks = -1;
  running = true;
  game.start({ style, onHud: renderHud, onEnd: finishRun });
}

function backToMenu() {
  running = false;
  game.stop();
  game.preview();
  renderBoards();
  renderIdentity();
  showMenu();
}

function finishRun(result) {
  running = false;
  const name = user?.name || 'Guest';
  const id = playerId(user);
  const saved = submitRun(id, {
    name,
    score: result.score,
    bossesReached: result.bossesDefeated,
    victory: result.victory,
  });

  $('overTitle').textContent = result.victory ? 'The arena is yours' : 'You died';
  $('overSub').textContent = result.victory
    ? 'All three fell before you.'
    : `You fell to boss ${Math.min(result.bossesDefeated + 1, result.bossTotal)} of ${result.bossTotal}.`;

  $('overStats').innerHTML = `
    <div><span>Score</span><b>${result.score.toLocaleString()}</b></div>
    <div><span>Bosses felled</span><b>${result.bossesDefeated} / ${result.bossTotal}</b></div>
    <div><span>Best ever</span><b>${saved.best.toLocaleString()}</b></div>
    <div><span>Runs</span><b>${saved.runs}</b></div>`;

  $('overBest').textContent = saved.isNewBest
    ? 'New personal best.'
    : `Your best is ${saved.best.toLocaleString()}.`;
  $('overBest').className = saved.isNewBest ? 'note good' : 'note';

  const buttons = $('overButtons');
  buttons.innerHTML = '';
  for (const [label, handler, kind] of [
    ['Fight again', startRun, 'primary'],
    ['Back to the menu', backToMenu, ''],
  ]) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `btn ${kind}`.trim();
    el.textContent = label;
    el.addEventListener('click', handler);
    buttons.append(el);
  }

  renderBoards();
  hud.hidden = true;
  menuScreen.hidden = true;
  overScreen.hidden = false;
}

// --------------------------------------------------------------------- hud

function renderBanner(banner) {
  const el = $('banner');
  if (!banner) {
    el.hidden = true;
    return;
  }
  $('bannerTitle').textContent = banner.title;
  $('bannerSub').textContent = banner.subtitle ?? '';
  el.hidden = false;
}

function renderHud(state) {
  if (state.bannerKey !== lastBannerKey) {
    lastBannerKey = state.bannerKey;
    renderBanner(state.banner);
  }

  // Bars and numbers don't need to be written 60 times a second.
  const now = performance.now();
  if (now - lastHudAt < 100) return;
  lastHudAt = now;

  $('hpFill').style.width = `${(state.hp / state.maxHp) * 100}%`;
  $('stFill').style.width = `${(state.stamina / state.maxStamina) * 100}%`;
  $('scoreLabel').textContent = state.score.toLocaleString();
  $('bossLabel').textContent = `Boss ${state.bossNumber} / ${state.bossTotal}`;

  const bossBar = $('bossBar');
  bossBar.hidden = !state.boss;
  if (state.boss) {
    $('bossName').textContent = state.boss.name;
    $('bossFill').style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
  }

  if (state.flasks !== lastFlasks) {
    lastFlasks = state.flasks;
    $('flaskRow').innerHTML = Array.from(
      { length: state.maxFlasks },
      (_, i) => `<i class="flask ${i < state.flasks ? 'full' : ''}"></i>`,
    ).join('');
  }
}

// -------------------------------------------------------------------- boot

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && running) backToMenu();
});

addEventListener('resize', () => {
  if (!running) game.preview();
});

$('pauseBtn').addEventListener('click', backToMenu);

onUserChange((next) => {
  user = next;
  style = normalizeStyle(next?.style ?? guestStyle());
  if (running) {
    // Signed in or out mid-run: repaint the hero, leave the fight alone.
    game.setStyle(style);
  } else {
    renderIdentity();
    renderBoards();
  }
});

renderIdentity();
renderBoards();
game.preview();
showMenu();

// Ask start.ng who is here. A slow or missing answer leaves us as a guest.
getCurrentUser().then((answer) => {
  user = answer;
  style = normalizeStyle(answer?.style ?? guestStyle());
  renderIdentity();
  renderBoards();
});