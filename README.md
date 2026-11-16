# VIDAA Launcher (vidaatvappsmanager)

A home screen for **websites and web apps** on Hisense / Toshiba **VIDAA** smart TVs, built to be used with the TV remote.

- 📺 **App grid you control with the remote.** Use the arrow keys and OK. 1–9 / 0 open apps 1–10 directly.
- ➕ **Add, edit, recolour, reorder and delete apps** on the TV.
- 🎨 **Colour-button shortcuts:** 🔴 app options · 🟢 add app · 🟡 edit mode · 🔵 settings.
- 🔁 **Sync your list from your phone.** Edit [`apps.json`](apps.json) on GitHub, then press *Settings → Load apps.json* on the TV. You can also import from any JSON link, and back up or restore your list.
- 🎬 **USB & network media player.** Pick files from a USB drive (if your firmware allows it) or play a video/audio/image link. OK = play/pause, ◀ ▶ = seek 10s, ▲ ▼ = previous/next.
- 💾 **Saves on the TV.** Your apps stay in the TV browser's storage. No account and no server needed.
- 🪶 **Plain HTML/CSS/ES5 JavaScript.** No build step and no dependencies, so it runs on older TV browser engines.

> ⚠️ **VIDAA is not Android.** No app, file manager or USB stick can install or run Android apps (APK files) on a VIDAA TV.
> This launcher opens **websites** (many services have a web version). For real Android apps, plug an **Android TV / Google TV stick** (e.g. Xiaomi TV Stick, Google TV Streamer) into an HDMI port.

---

## 1. Put it online (free, with GitHub Pages)

The TV needs a web address to open, so host the launcher online first:

1. Merge this branch into `main`.
2. On GitHub, open the repo → **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then branch **`main`** and folder **`/ (root)`**. Press **Save**.
4. After about a minute your launcher is live at:
   **`https://yamaharazef-hub.github.io/vidaatvappsmanager/`**

## 2. Open it on the TV

1. On the VIDAA home screen, open the **Browser** app.
2. Type the address above and open it.
3. **Bookmark it** or set it as the browser's home page, so the launcher opens every time you start the Browser.

> Tip: a short link (for example from a URL shortener) is much quicker to type with the remote.

## 3. Use it

| Remote key | Action |
|---|---|
| Arrows | Move |
| OK | Open app / select |
| BACK | Close dialog → leave edit mode → back to Apps → exit |
| 🔴 RED | Options for the selected app (edit, move, delete…) |
| 🟢 GREEN | Add a new app |
| 🟡 YELLOW | Edit mode on/off |
| 🔵 BLUE | Settings |
| 1–9, 0 | Open app 1–10 directly |

**Moving apps:** RED (or Edit mode → OK) → **Move**, then use the arrows to move the app. Press OK when it's in place.

**Returning from an app:** with "Open apps in: Same window" (the default), press **BACK** inside the website to return to the launcher.

## 4. Edit your app list from your phone or PC

Typing on a TV is slow, so you can do it on GitHub instead:

1. On GitHub, open [`apps.json`](apps.json) → ✏️ Edit.
2. Add apps like this:
   ```json
   { "name": "Jellyfin", "url": "http://192.168.1.20:8096", "color": "#7c3aed" }
   ```
   `icon` (an image link) is optional. If you leave it out, the site's icon is used.
3. Commit. On the TV, go to **Settings → Load apps.json**.

You can also paste a JSON list into **Settings → Backup / restore**, or import from a link (e.g. a raw GitHub Gist).

## Notes & limitations

- **Some websites may not work** in the VIDAA browser. They might block TV browsers, need DRM, or be built for touch screens. Remove those, and use the TV's built-in apps (Netflix, YouTube, Prime Video, etc.) where available.
- **USB file picker:** whether the browser can open files from a USB drive depends on your TV model and firmware. If it can't, use the TV's built-in **Media Player**.
- **Video formats** depend on what the TV browser supports. MP4 (H.264/AAC) is the safest choice.
- **`http://` media links** (e.g. a local network server) may be blocked when the launcher runs from an `https://` address. Use `https://` links where possible.
- Website icons come from Google's favicon service. You can turn this off in Settings.

## Development

```bash
npm start        # serves the app on http://localhost:8080
npm install      # once, for the test tools
npm test         # ES5 syntax check + navigation unit tests + jsdom UI tests
```

On a PC keyboard: arrows/Enter work as usual, **Esc** = BACK, **R/G/Y/B** = colour buttons.

```
index.html            UI markup (views, dialogs, player)
css/style.css         TV styles (scales with screen width, overscan-safe)
js/spatial.js         arrow-key spatial navigation (pure, unit-tested)
js/app.js             launcher logic, storage, media player, remote keys
js/defaults.js        built-in fallback app list (keep in sync with apps.json)
apps.json             default / synced app list
tests/run.js          test suite
```
