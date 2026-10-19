// start.ng owns sign-in. The game asks it who is signed in through a hidden
// start.ng/connect page, and gets back { user, guest }: a signed-in player, or
// start.ng's own guest look when nobody is. When start.ng sends a player back
// from signing in it also hands over a game session in the address, which only
// works for this game. That session is the reliable answer for a player who has
// just signed in (the connect frame can be walled off from start.ng's storage in
// some browsers), so it is checked first. The game never sees a password, email
// or the player's real start.ng token.

// Where start.ng lives, worked out from where this game is served.
function findStartNg() {
  const { hostname } = location;
  if (hostname.endsWith('.start.ng')) return 'https://start.ng';
  if (hostname.endsWith('.start.localhost')) return 'http://start.localhost:5173'; // local testing
  return null; // anywhere else (e.g. a plain static server) there's no start.ng, so guests only
}

/** start.ng's address, or null when the game runs somewhere start.ng can't reach. */
export const START_NG = findStartNg();

const GAME = location.hostname.split('.')[0];
const API = location.hostname.endsWith('.start.ng') ? 'https://api.start.ng' : null;
const SESSION_KEY = 'startng:game-session';

// Read the session start.ng handed back, keep it for the tab, and strip it from
// the address bar so it doesn't linger there. A saved session survives reloads.
let gameSession = null;
{
  const params = new URLSearchParams(location.hash.slice(1));
  const fresh = params.get('startng_session');
  if (fresh) {
    const seconds = Number(params.get('expires_in')) || 7200;
    gameSession = { token: fresh, expires: Date.now() + seconds * 1000 };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(gameSession));
    } catch {
      /* private mode: the session still works for this page */
    }
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
      if (saved?.token && saved.expires > Date.now()) gameSession = saved;
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* no saved session: ask the connect page instead */
    }
  }
}

function forgetSession() {
  gameSession = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

// Resolves to the user, null (session expired or rejected), or undefined if the
// API could not be reached — never treat a failed request as "signed out".
async function whoFromSession() {
  if (!API || !gameSession) return undefined;
  if (gameSession.expires <= Date.now()) {
    forgetSession();
    return null;
  }
  try {
    const res = await fetch(`${API}/games/${encodeURIComponent(GAME)}/player`, {
      headers: { Authorization: `Bearer ${gameSession.token}` },
    });
    if (res.status === 401) {
      forgetSession();
      return null;
    }
    if (!res.ok) return undefined;
    const player = await res.json();
    if (!player || player.id == null) return null;
    return { id: player.id, name: player.name || 'Player', style: player.style ?? null };
  } catch {
    return undefined;
  }
}

let frame;
function connectFrame() {
  frame ??= new Promise((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    el.title = 'start.ng sign-in check';
    el.addEventListener('load', () => resolve(el), { once: true });
    el.addEventListener('error', reject, { once: true });
    document.body.append(el);
  });
  return frame;
}

// start.ng's guest look, remembered from the last whoami reply so guests match
// their character in every game. Null when start.ng never answered.
let guestLook = null;

// The connect page can be slow on a cold start: it has to load the app, fetch the
// account and paint the character's face before it can answer. A single ask would
// miss it and leave a signed-in player looking signed out, so keep asking and keep
// listening instead of giving up after one shot.
const LOAD_TIMEOUT = 10000;
const REPLY_TIMEOUT = 12000;
const ASK_EVERY = 800;

// Resolves to the user, null (signed out), or undefined if start.ng didn't answer.
async function connectWho() {
  let el;
  try {
    el = await Promise.race([
      connectFrame(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('connect page did not load')), LOAD_TIMEOUT)),
    ]);
  } catch {
    return undefined;
  }
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    let settled = false;
    let timer;
    let repeat;
    const done = (user) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(repeat);
      removeEventListener('message', onMessage);
      resolve(user);
    };
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === 'startng:user' && e.data.requestId === requestId) {
        guestLook = e.data.guest?.style ?? guestLook;
        done(e.data.user ?? null);
      }
    }
    const ask = () => el.contentWindow.postMessage({ type: 'startng:whoami', requestId }, START_NG);
    addEventListener('message', onMessage);
    ask();
    repeat = setInterval(ask, ASK_EVERY);
    timer = setTimeout(() => done(undefined), REPLY_TIMEOUT);
  });
}

// The connect page is not needed to identify a player who came back with a
// session, but it is the only place start.ng's guest look comes from. Ask it in
// the background when we use a session, so guests still match start.ng.
let warming;
function warmGuestLook() {
  warming ??= connectWho();
}

async function check() {
  if (!START_NG) return null;
  const fromSession = await whoFromSession();
  if (fromSession) {
    warmGuestLook();
    return fromSession;
  }
  return connectWho();
}

/** The signed-in start.ng user ({ id, name, style }), or null. */
export async function getCurrentUser() {
  return (await check()) ?? null;
}

/** start.ng's guest style, when it has told us one; the caller falls back to a default. */
export function guestStyle() {
  return guestLook;
}

/**
 * Re-checks when the player comes back to this tab or window, since they may have
 * signed in or out on start.ng.
 */
export function onUserChange(fn) {
  const recheck = async () => {
    if (document.visibilityState !== 'visible') return;
    const user = await check();
    if (user !== undefined) fn(user); // ignore a check that failed, rather than signing the player out
  };
  document.addEventListener('visibilitychange', recheck);
  addEventListener('focus', recheck);
  addEventListener('pageshow', (e) => {
    if (e.persisted) recheck(); // restored from the back/forward cache: the old answer may be stale
  });
}

const RETURN_FLAG = 'startng:returning';

/** True for the first load after start.ng sent the player back from signing in. */
export function returnedFromSignIn() {
  try {
    const at = Number(sessionStorage.getItem(RETURN_FLAG));
    if (!at) return false;
    sessionStorage.removeItem(RETURN_FLAG);
    return Date.now() - at < 5 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Sends the player to start.ng to sign in. start.ng brings them back here afterwards. */
export function signIn() {
  if (!START_NG) return;
  try {
    sessionStorage.setItem(RETURN_FLAG, String(Date.now()));
  } catch {
    /* private mode: the game just checks as usual on return */
  }
  location.href = `${START_NG}/?return_to=${encodeURIComponent(location.href)}`;
}

/** Leaves for start.ng, forgetting this game's session so coming back shows a guest. */
export function signOut() {
  forgetSession();
  if (START_NG) location.href = `${START_NG}/`;
}