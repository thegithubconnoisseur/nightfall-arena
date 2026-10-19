// start.ng owns sign-in. The game asks it who is signed in through a hidden
// start.ng/connect page, and gets back { user, guest }: a signed-in player, or
// start.ng's own guest look when nobody is. The game never sees the start.ng
// token or email.

// Where start.ng lives, worked out from where this game is served.
function findStartNg() {
  const { hostname } = location;
  if (hostname.endsWith('.start.ng')) return 'https://start.ng';
  if (hostname.endsWith('.start.localhost')) return 'http://start.localhost:5173'; // local testing
  return null; // anywhere else (e.g. a plain static server) there's no start.ng, so guests only
}

/** start.ng's address, or null when the game runs somewhere start.ng can't reach. */
export const START_NG = findStartNg();

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
async function check() {
  if (!START_NG) return null;
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