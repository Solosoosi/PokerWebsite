# Home Poker League: project brief

A static website for a 6-player home poker league, hosted on GitHub Pages. No build step. `index.html` is the league and standings page; `tv.html` and `remote.html` are the game-night TV screen and phone remote (see "Sync approach").

## League rules (already implemented in index.html)

- 7 players, a season of 5 rounds (one round per game night). Casual: no fixed schedule, so the site shows none.
- Points by finishing place: 1st 12, 2nd 8, 3rd 6, 4th 4, 5th 3, 6th 2, 7th 1.
- Knockouts: +0.5 point per player you eliminate.
- Final round (round 5) finishing points ×1.5.
- Drop worst round: only a player's best 4 of 5 rounds count (applies once all 5 are played).
- Tiebreak: most points, then most 1st places, then most knockouts.
- The three rules above (KO points, final ×1.5, drop worst) are toggles on the page.

## Game night format

- No-Limit Texas Hold'em, re-entry format: each player gets 2 entries (buy-in plus one re-entry). Bust early and you rejoin immediately with a fresh stack.
- Re-entry window closes at the end of Level 3; after that it's a freezeout.
- Only a player's final bust sets their finishing place. Knockouts scored before a re-entry still count.

Starting stack: 652 per entry = 2×100, 6×50, 5×25, 4×5, 7×1.

Chip inventory owned: 50×100, 100×50, 50×25, 50×5, 50×1. (At 12 full entries the 25s and 1s run short, so they get colored up as the night goes on.)

Blinds (big / small) and level durations:

| Level | Blinds | Duration |
|---|---|---|
| 1 | 5 / 1 | 30 min |
| 2 | 10 / 5 | 45 min |
| 3 | 25 / 10 | 60 min (last level with re-entry) |
| 4 | 50 / 25 | 60 min (assumed, not confirmed by the user) |
| 5 | 100 / 50 | no timer, heads-up level, play to the finish |

## What exists now (index.html)

Dark felt-green card-room theme (Fraunces + Inter fonts, brass accent), cleaned up and flat. Contains: editable league name and player names, a standings leaderboard with champion highlight, a results grid (finish per round + season KO total per player), points rules with toggles, the re-entry rules, a chip-stack diagram, and a blinds clock (start/pause, reset, prev/next, auto-advance with a beep, clickable level timeline). Data saves to localStorage; a "Copy data for GitHub" button exports the seed JSON block to commit so everyone sees the standings.

## Next phase: TV screen + phone remote

Split into two connected views:

**TV view** (shown on a big screen during the game): very large countdown clock, current and next blinds, player cards with funny photos (the user will provide one photo per player), busted players greyed out with an "OUT" mark, current standings in a corner. Needs a fullscreen button, a screen wake lock so the TV doesn't sleep, and a QR code that phones scan to connect.

**Phone remote**: start/pause/reset/skip the timer, mark a bust (tap who busted, then who knocked them out), edit points, KOs and results. Changes on the phone show on the TV live. More than one phone should be able to connect.

Suggested upgrade agreed in principle: recording busts on the phone should produce the night's finishing order and KO points automatically, so results never get typed in by hand.

## Sync approach (built)

Decided: no account, peer-to-peer over PeerJS (public PeerJS server, WebRTC data channels). The user asked for **the data to live on the phones**, not the TV.

Files (plain HTML/CSS/JS, no build step):
- `sync.js`: the TV hosts a room (peer id `hpl-room-<CODE>`, code kept in the TV's localStorage so it survives refreshes) and relays; phones join, auto-reconnect (retry, connect timeout, heartbeat, reconnect on wake) and measure their clock offset to the TV.
- `league.js`: points rules (mirrors index.html; change both), blinds `LEVELS`, clock maths, game-night logic, player avatars.
- `tv.html`: display only. Keeps a display copy (`pokerLeague.tv.v1`) so a refresh doesn't blank the clock. Fullscreen button, wake lock, QR to `remote.html?room=CODE`, beep on level change (after one tap on the TV). Sized in `rem`, where `html{font-size:min(1vh,.6vw)}` (portrait: `min(1vw,.55vh)`, stacked layout), so it fits any screen shape. `fit()` picks player-card columns/rows for the count and width, shrinks the standings to fit (two columns before it gets too small), and scales the clock to the room left. Checked at 16:9, 16:10, 4:3, 5:4, 21:9, 1:1, 3:4 and 9:16 with up to 14 players. Background: a GTA loading-screen style slideshow of the group's photos (shuffled, 9 s each, crossfade, pan and zoom via `Element.animate`, saturated, halftone dots, dark green tint). Photos live in `backgrounds/` (shrunk to 1800px from the originals in `Player pics/`, which isn't uploaded) and are listed in `backgrounds/list.json`; GitHub Pages can't list a folder, so a new photo needs adding to that list.
- `remote.html`: the phone. Holds the real data: league in `pokerLeague.v1` (same key as index.html, so the phone's standings page sees it) and clock + night in `pokerLeague.live.v1`. The seed comes from index.html's seed block via fetch.
- `theme.css`: shared tokens for tv/remote.
- `sw.js`: service worker, network-first with a cache fallback for site files, CDN libraries, fonts and photos (never the PeerJS server), so the pages open with no internet after one visit.
- Same-device link: `sync.js` also uses a BroadcastChannel, so the TV's "Controls" panel (remote.html in an iframe) runs the night with no internet and no PeerJS server.

Shared state: `{updatedAt, epoch, league, clock, clockAt, night, past, photos}`. Every phone keeps a full copy; the newest `updatedAt` (in TV clock time) wins as a whole, then the receiving phone merges back what only it had (`mergeFrom` in remote.html): busts and removals per night id (busts carry `{id, at, by}`, removals are kept in `night.removed`, `League.cleanBusts` drops cross-device duplicates and impossible busts), the clock if its `clockAt` is newer, and nights the other copy never saw. A device's first night always has id `n0`. "Reset to published" starts a new `epoch`, and copies from different epochs never merge. `past` holds earlier nights (reopen one to fix it). Guests are league players with `guest:true`: they take places and KOs and appear in the standings like anyone, but a new night doesn't include them until tapped in; a guest with no results is removed when tapped off. (Old `night.guests` entries are moved into the league on load.) The clock is `{i, running, endAt, remaining}` and every device derives the current level from it, so level roll-over needs no writes. The room code is the only write protection.

Bust tracking: `night = {round, playing, busts:[{v, k, re, lvl}], applied}`. `k` is null when a player left the game (no KO). Re-entry is offered while the player has an entry left and the level is 1-3; after that the sheet defaults to "out" with a "Re-enter anyway" override (for a bust recorded late). Any bust can be removed from the history or have its knockout changed in place (order kept); players can be added mid-night (late arrival) and removed only if they're in no bust. "Reset to published" on a phone (league key gone, live key present) becomes a fresh start that wins over older copies. index.html reloads when the remote writes the league in another tab. KOs go into the season total as they happen; places are written to that round once one player is left. `applied` records what was written so undo stays correct.

Player photos: a photo added on a phone (Players card, tap the picture) comes first. It is shrunk to 320px JPEG and kept in `state.photos[pid] = {d: dataURL|null, at}` (in the live key, not the league, so the GitHub seed stays small), merged newest-per-player across phones and epochs. Otherwise `players/<Name>.jpg|jpeg|png|webp` (or lowercase name), initial as fallback.

`sw.js` fetches the site's own files with `cache:"no-cache"`, so a new page never runs with an old script from the browser cache (GitHub Pages sends max-age=600).

## Open items

- Level 4 duration (60 min) is an assumption.
- Players (from the photo file names in `players/`): אבינועם, אודקס, טומי, יותקיי, יפתח, עילי, רתם. The season seed starts at zero (no places, no KOs).
- 7 players × 2 entries = up to 14 entries of 652; the chip inventory (written for 12 entries) runs shorter still.
- Wake lock was not verifiable in the dev preview browser (permission denied there); the TV status line says "screen stays awake" when it works.
