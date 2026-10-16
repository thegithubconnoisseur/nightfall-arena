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

// Resolves to the user, null (signed out), or undefined if start.ng didn't answer.
async function check() {
  if (!START_NG) return null;
  let el;
  try {
    el = await connectFrame();
  } catch {
    return undefined;
  }
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (user) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(user);
    };
    const timer = setTimeout(() => done(undefined), 3000);
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === 'startng:user' && e.data.requestId === requestId) {
        guestLook = e.data.guest?.style ?? guestLook;
        done(e.data.user ?? null);
      }
    }
    addEventListener('message', onMessage);
    el.contentWindow.postMessage({ type: 'startng:whoami', requestId }, START_NG);
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
}

/** Sends the player to start.ng to sign in. start.ng brings them back here afterwards. */
export function signIn() {
  if (!START_NG) return;
  location.href = `${START_NG}/?return_to=${encodeURIComponent(location.href)}`;
}