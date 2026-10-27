# Breathing Timer (offline PWA)

A small, private breathing-exercise timer with English + Burmese (မြန်မာ) labels.

- **Belly breathing** — inhale through the nose 4 s, exhale through the mouth 6 s; 3 / 4 / 5 min.
- **Pursed-lip breathing** — inhale through the nose 2 s, exhale through pursed lips 4 s; 2 / 3 / 5 min.

Animated circle, per-phase countdown, remaining time, optional soft beep and vibration,
screen wake lock, a quick "how do you feel" log, history, today's 3 sessions goal
(morning / after lunch / evening), streak, and CSV export (opens correctly in Excel, incl. Burmese).

**Privacy:** no frameworks, no CDNs, no analytics, no network calls. All data is stored only in this
browser's `localStorage` (key `breathingTimer.v1.sessions`). Clearing site data deletes the history —
use **Export CSV** to keep a backup.

> If you feel dizzy or chest tightness, stop and breathe normally. Persistent symptoms: see a doctor.

## Run / install

Installing a PWA (and the offline service worker) requires **HTTPS or `localhost`**.
Opening `index.html` directly as a `file://` page will show the timer, but it will not install or work offline.

**(a) Run locally**

```bash
cd breathing-timer
python -m http.server 8000     # or: python3 -m http.server 8000
```

Open <http://localhost:8000> in Chrome / Edge and click the **Install** icon in the address bar
(or menu → *Install Breathing Timer*). After the first load it works fully offline.

Note: to use it on your phone, the phone must open it over HTTPS — `http://<your-PC-IP>:8000` will
work as a web page but will not install or go offline. Use option (b) for phones.

**(b) Host on any static HTTPS host** — e.g. GitHub Pages or Cloudflare Pages. Upload the folder
contents as-is (all paths are relative, so any sub-path such as `https://user.github.io/breathing-timer/`
works). Then open the URL on your phone: Android Chrome → *Install app* / *Add to Home screen*;
iPhone Safari → Share → *Add to Home Screen*.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup |
| `style.css` | Styles (light/dark via `prefers-color-scheme`, reduced-motion support) |
| `app.js` | Timer engine, cues, wake lock, log, history, stats, CSV export |
| `manifest.webmanifest` | PWA manifest |
| `sw.js` | Service worker (cache-first precache, versioned cache) |
| `icons/` | 192/512 icons, maskable variants, apple-touch-icon |
| `make_icons.py` | Regenerates the icons (needs Pillow) |

## Updating

When you change any file, bump `CACHE_VERSION` in `sw.js` (e.g. `v1` → `v2`) so installed copies
pick up the new version; old caches are deleted automatically. Reload the app twice to see changes.

## Known limitations

- **Vibration** is not supported on iPhone/iPad (Safari has no `navigator.vibrate`) or most desktops; the toggle is disabled there.
- **Wake Lock** needs a recent browser (Chrome/Edge 84+, Safari 16.4+); otherwise keep the screen on manually. Battery saver may refuse it.
- **Background tabs / locked screen:** timing stays correct (it is computed from the clock, not by counting ticks), but browsers throttle or suspend background pages, so beeps/vibrations may be late or skipped while the app is hidden, and audio may not play at all on iOS when the screen is locked. Keep the app in the foreground during a session.
- The first beep needs a tap (browsers only allow audio after a user gesture — pressing Start counts).
- Data lives in one browser on one device; there is no sync. Export CSV to back up.
