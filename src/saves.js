// Best scores and a small leaderboard, kept in localStorage and keyed by user id.
// A guest gets a stable generated id so their scores survive a reload.

const STORE_KEY = 'nightfall-arena/v1';
const EMPTY = () => ({ players: {}, guestId: null });

function read() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object' || typeof data.players !== 'object' || !data.players) return EMPTY();
    return data;
  } catch {
    return EMPTY(); // storage disabled or half-written json: play on, just don't remember
  }
}

function write(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* quota or a private window: scores just won't persist */
  }
}

function guestId() {
  const data = read();
  if (typeof data.guestId !== 'string' || !data.guestId) {
    data.guestId = `guest-${Math.random().toString(36).slice(2, 10)}`;
    write(data);
  }
  return data.guestId;
}

/** A stable key for this player: their start.ng id, or the local guest id. */
export function playerId(user) {
  return user?.id ? `u:${user.id}` : guestId();
}

export function getBest(id) {
  const p = read().players[id];
  return typeof p?.best === 'number' ? p.best : 0;
}

/** Records a finished run and reports whether it beat this player's previous best. */
export function submitRun(id, { name, score, bossesReached, victory }) {
  const data = read();
  const previous = data.players[id] ?? {};
  const best = Math.max(previous.best ?? 0, score);
  const isNewBest = score > (previous.best ?? 0);
  data.players[id] = {
    name: name || 'Guest',
    best,
    bosses: Math.max(previous.bosses ?? 0, bossesReached),
    runs: (previous.runs ?? 0) + 1,
    victory: Boolean(previous.victory || victory),
    at: Date.now(),
  };
  write(data);
  return { best, isNewBest, runs: data.players[id].runs };
}

/** Top players by best score. */
export function leaderboard(limit = 5) {
  return Object.entries(read().players)
    .map(([id, p]) => ({
      id,
      name: typeof p?.name === 'string' && p.name ? p.name : 'Guest',
      best: typeof p?.best === 'number' ? p.best : 0,
      bosses: typeof p?.bosses === 'number' ? p.bosses : 0,
      runs: typeof p?.runs === 'number' ? p.runs : 0,
    }))
    .filter((row) => row.runs > 0)
    .sort((a, b) => b.best - a.best || a.name.localeCompare(b.name))
    .slice(0, limit);
}