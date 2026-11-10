# LDR Theater — browser extension

Watch streaming services in step with your partner, from inside the room you
already share in LDR Companion.

The web app's Watch tab ([`watch.js`](../watch.js)) already syncs YouTube and
direct video URLs. It cannot sync Netflix, Disney+, Max, Hulu or Prime Video,
because those players only exist on their own origins and a web page has no way
to reach into them. That is the gap this extension fills.

## How it works

Each person installs the extension, enters the **same room code** they use in
the app, and opens the **same title** on their **own** account. The extension:

1. finds the page's `<video>` element (per-site adapter in [`src/adapters.js`](src/adapters.js))
2. joins a Supabase Realtime broadcast channel named `theater:<ROOM>`
3. estimates the clock offset between the two browsers, NTP-style — ping/pong,
   median of samples, so one-off network spikes don't skew it
4. keeps the two playheads together, correcting drift with the gentlest
   available tool: a `playbackRate` nudge inside ±0.35 s, a real seek past 1.5 s
5. renders whispers, typing indicators and floating reactions over the video

### What is *not* happening

- **No video data is relayed.** Each browser streams from the service directly.
- **No DRM is touched, bypassed, or weakened.** The extension only calls the
  page's ordinary transport controls (`play`, `pause`, seek) — the same thing
  clicking the player does.
- **No account or subscription sharing.** You each need your own subscription;
  the extension cannot create access that isn't already there.
- **No credentials are read.** The page bridge
  ([`src/page-bridge.js`](src/page-bridge.js)) exposes exactly four commands:
  play, pause, seek, position.

## Build

The extension reads the **same `.env`** as the web app, so there is nothing new
to configure:

```bash
npm run build:ext
```

Output lands in `dist-extension/` (gitignored). Then:

1. open `chrome://extensions`
2. enable **Developer mode**
3. **Load unpacked** → select `dist-extension/`

Both of you need to do this — the extension is the client, so it has to be
installed on both sides.

Only the Supabase **publishable** key is bundled, which is the same key the web
client already serves to every browser. RLS remains the authorization boundary.

## Use

1. Click the extension icon.
2. Enter your room code, pick which partner you are, optionally add names.
3. **Connect.**
4. Open the same title on a supported service. The overlay appears bottom-right.

**Following / Paused** in the overlay header stops syncing without
disconnecting — useful when one of you needs to step away or rewind alone.

If you end up on different episodes, the overlay says so instead of silently
fighting over the playhead.

## Supported services

| Service | Sync | Notes |
|---|---|---|
| Netflix | ✅ | Seeks route through its own player API; rate-nudge disabled (its ABR controller dislikes off-nominal rates) |
| Disney+ | ✅ | |
| Max / HBO Max | ✅ | |
| Hulu | ✅ | |
| Prime Video | ✅ | Runs in all frames; Prime sometimes nests its player |
| YouTube | ✅ | Redundant with the in-app player, but works on youtube.com itself |

Any other site with a plain HTML5 `<video>` would work via the base adapter —
it just isn't in `manifest.json`'s host list. Add a host there and to
`content_scripts.matches` to opt it in.

## Why these sites break, and where to look

Streaming sites are SPAs that rewrite their DOM constantly, and they rename
their internal classes without notice. Two consequences:

- **Adapters are the fragile part.** If sync stops working on one service after
  a site redesign, the cause is almost certainly `findVideo()` or `title()` in
  [`src/adapters.js`](src/adapters.js). Each falls back to a generic
  largest-visible-video heuristic, so it usually degrades rather than dies.
- **Navigation is polled, not hooked.** `content.js` watches `location.href`
  on an interval because these sites don't fire usable navigation events.

## Files

| File | Role |
|---|---|
| `src/content.js` | Entry point; owns the Supabase connection and wiring |
| `src/sync.js` | Clock-offset estimation + drift correction (transport-agnostic) |
| `src/adapters.js` | Per-site player adapters |
| `src/bridge.js` / `src/page-bridge.js` | Content↔page-context bridge for Netflix's player API |
| `src/overlay.js` / `src/overlay.css` | Chat, reactions, presence UI (`.ldrt-*` namespaced) |
| `src/popup.html` / `src/popup.js` | Room pairing |
| `src/background.js` | Session storage + toolbar badge |

## Relationship to the web app

Nothing in the web app was modified. The extension is additive:

- it uses channel `theater:<room>`, deliberately distinct from the app's
  `watch:<room>`, so the two features cannot cross-talk
- it needs **no schema changes** — sync is broadcast-and-presence only, so
  `watch_sessions` and its `source` CHECK constraint are left alone
- `npm run build` (web app) and `npm run build:ext` are separate configs with
  separate output directories
