# Nightfall Arena

A third-person souls-like boss rush in the browser. Three monsters stand between you
and daylight. You get one blade, one gun, a dodge roll, and three healing flasks.

Built with three.js. No build step, no bundler, no server code — just static files.

## How to play

You run around a colosseum pit and fight three bosses in order. Each one is bigger and
meaner than the last, and the last one summons minions.

| Input | What it does |
| --- | --- |
| W or up-arrow | Runs straight ahead, wherever you are facing |
| S or down-arrow | Backs away, still facing the same way |
| A/D or left/right arrows | Turns on the spot; the camera follows round |
| Left click or J | Sword swing |
| Right click or K | Gunshot |
| Space or Shift | Dodge roll, briefly invulnerable |
| Q | Drink a flask |
| Esc | Back to the menu |

Stamina gates everything. Swinging and rolling both spend it, and it only comes back
after you stop for a moment. Run out mid-fight and you are a sitting duck — that is the
whole tension of the game.

A few things worth knowing:

- Hold the roll for its i-frames. The boss telegraphs every big attack with a ring on
  the sand first, so the roll is a reaction, not a guess.
- You face where you turn. Running forward never swings the camera; turning does, all
  the way round if you hold it.
- The gun auto-picks the closest monster inside a narrow cone in front of you, so you do
  not have to be pixel-perfect with it.
- When a boss dies you get a breather and a free flask refill. Use it.

Score comes from damage dealt and monsters killed. Your best score and a small
leaderboard are kept in the browser, keyed to whoever is playing.

## Running it locally

Two ways, depending on whether you want the start.ng sign-in or not.

### Anywhere (guest only)

Serve the folder with any static file server and open it:

```
cd nightfall-arena
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Because the hostname is not a start.ng one, the game
decides there is no start.ng to talk to and plays as a guest, with a short note on the
menu explaining why. Everything except sign-in works.

### On start.ng locally (full sign-in)

The Worker lives in the `startng-fe` repo (`worker/` folder) and serves each game from
its own subdomain out of a storage bucket. This project includes a checkout of that repo
in `harness/`, plus a local-only `worker/wrangler.local.toml` that is never deployed.

1. Start the Worker, from `harness/startng-fe/worker`:

   ```
   npx -y wrangler@4.145.0 dev -c wrangler.local.toml --port 8787 --ip 127.0.0.1
   ```

2. Put the game files in the local bucket, from the same folder:

   ```
   npx -y wrangler@4.145.0 r2 object put "startng-games-local/nightfall-arena/index.html" --file "../../../nightfall-arena/index.html" --local -c wrangler.local.toml
   ```

   ...and the same for `styles.css` and everything under `src/`.

3. Start start.ng itself (Vite, in `harness/startng-fe`), bound to IPv4 so
   `start.localhost` can reach it:

   ```
   npm run dev -- --host 127.0.0.1
   ```

4. Optionally start start.ng's backend (FastAPI, in `harness/startng-be`) if you want to
   actually sign in as somebody.

5. Open `http://nightfall-arena.start.localhost:8787`.

Note: never open plain `localhost:8787` — with no game name in front of it the request
loops.

## How it uses start.ng

The game never sees passwords, tokens or emails, and never calls the start.ng API. All of
the sign-in wiring is in one file, `src/platform.js`.

When the game loads it drops a hidden iframe pointing at `<start.ng>/connect` and asks it
`startng:whoami` over `postMessage`. start.ng replies with `{ id, name, style }` or null.
The game only accepts a reply whose origin is start.ng, whose source is that exact
iframe, and whose request id matches the one it sent. If no reply arrives within three
seconds the game treats it as "no answer" rather than "signed out", so a slow start.ng
never knocks you back to guest.

Where start.ng lives is worked out from the hostname: `.start.ng` means production,
`.start.localhost` means the local dev stack, and anything else means there is no
start.ng at all and the game runs guest-only.

Signing in sends you to start.ng with a `return_to` pointing back at the game, and
start.ng brings you back once you are done. The check re-runs when you come back to the
tab or the window, so if you sign out on start.ng the game notices.

Your start.ng look lands on your character:

- `primaryColor` → armour, `secondaryColor` → trousers, `skinColor` → skin,
  `hairColor` → hair
- `hat` → `none`, `cap`, `beanie`, `tophat`, `crown`
- `accessory` → `none`, `glasses`, `scarf`, `backpack`

Every value is validated and falls back to a default rather than breaking, because
start.ng may add hats and accessories later. Colours it does not recognise, and hats or
accessories it has never heard of, quietly become the default look.

Guests get a default look and are saved as "Guest". Scores and the leaderboard live in
`localStorage` under `nightfall-arena/v1`, keyed by the start.ng user id, or by a
generated guest id that persists across reloads.

## Files

```
index.html        the page, plus the three.js import map
styles.css        menu, HUD, banners
src/main.js       screens, buttons, HUD rendering
src/game.js       the game: arena, bosses, combat, camera
src/character.js  builds the hero and maps a start.ng style onto it
src/platform.js   the start.ng sign-in handshake
src/saves.js      best scores and leaderboard in localStorage
```
