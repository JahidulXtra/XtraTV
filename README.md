# Xtra TV

A free, browser-based live TV player — news, sports, entertainment and more,
streamed via HLS (`.m3u8`) and direct video/audio URLs. Pure HTML/CSS/JS, no
build step, no framework, no dependencies beyond [hls.js](https://github.com/video-dev/hls.js) (loaded lazily from a CDN).

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Project Structure](#project-structure)
- [Architecture Notes](#architecture-notes)
- [Credits](#credits)

## Features

- Live channel grid, grouped by category, with instant search
- Favorites and watch history
- HLS player: adaptive quality selector, playback speed, fit mode (contain/cover/fill), fullscreen, theater mode, Picture-in-Picture
- Play any direct network stream (HLS/MP4/MKV/WebM/MP3) by pasting a URL
- Sleep timer with countdown indicator
- Full keyboard shortcut support
- Splash/loading screen, toast notifications, fully responsive (desktop + mobile)
- Client-side caching of the channel list (10-minute TTL) for fast repeat loads

## Tech Stack

- Vanilla HTML5, CSS3, JavaScript (ES2020+) — no build tools, no bundler, no framework
- [hls.js](https://github.com/video-dev/hls.js) for HLS playback (lazy-loaded from cdnjs on first use)
- `localStorage` for persisted preferences (favorites, history, volume, fit mode, sort order)
- Remote channel list fetched from a JSON endpoint (see [Configuration](#configuration))

## Getting Started

Just double-click `index.html` to open it directly in a browser.

This works fine **if `JSON_URL` points at the remote source** (the default).
If you switch to the local `data/channels.json` (see below), opening via
`file://` will fail: browsers block `fetch()` of local files for security
(CORS). In that case, serve the folder with any local web server, e.g.:

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000
```

then open `http://localhost:8000` in a browser.

## Configuration

### Channel source — `data/channels.json`

`js/storage.js` defines `JSON_URL`, the channel list source. By default it
points at a **remote** endpoint; `data/channels.json` is bundled as a
demo/template, kept so that switching to (or maintaining) your own local
channel list later is quick and easy — just edit this file and flip one
config line, no app logic to touch.

Expected schema — a flat array of objects:

```json
[
  {
    "name": "Channel Name",
    "category": "News",
    "logo": "https://example.com/logo.png",
    "url": "https://example.com/stream.m3u8"
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Display name |
| `url` | Yes | HLS (`.m3u8`) or direct MP4/MKV/WebM/MP3 stream |
| `category` | No | Groups the channel under this name in the sidebar |
| `logo` | No | Falls back to a generic icon if omitted |

The parser (`parseJSON` in `js/channels.js`) is forgiving — it also accepts
`title`/`stream`/`link`/`group`/`cat`/`image`/`icon` as alternate key names,
and an object-of-arrays shape (`{ "channels": { "News": [...], "Sports": [...] } }`)
instead of a flat array.

To switch the active source, edit `js/storage.js`:

```js
// Current (active): remote source
const JSON_URL = 'https://cdn.jsdelivr.net/gh/bugsfreeweb/LiveTVCollector@main/LiveTV/Bangladesh/LiveTV.json';
// const JSON_URL = 'data/channels.json';

// To use the local demo file instead, flip the comments:
// const JSON_URL = 'https://cdn.jsdelivr.net/gh/bugsfreeweb/LiveTVCollector@main/LiveTV/Bangladesh/LiveTV.json';
const JSON_URL = 'data/channels.json';
```

> The 5 sample channels in `data/channels.json` have been verified end-to-end
> through the app's real `parseJSON`/`processChannels` functions.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` / `K` | Play / Pause |
| `M` | Mute / Unmute |
| `F` | Fullscreen |
| `P` | Picture-in-Picture |
| `S` | Playback speed menu |
| `T` | Theater mode |
| `Z` | Sleep timer |
| `←` / `→` | Previous / next channel (seek ±10s in VOD/direct streams) |
| `↑` / `↓` | Volume up / down |
| `1` / `2` / `3` | Fit mode: contain / cover / fill |
| `F2` | Toggle favorite |
| `?` | Show shortcuts help |
| `Esc` | Close any open modal/popup |

## Project Structure

```
xtra-tv/
├── index.html             HTML structure
├── css/
│   ├── variables.css      CSS custom properties + base reset
│   ├── style.css          Main layout & component styles
│   ├── animations.css     All @keyframes
│   └── responsive.css     All @media query overrides
├── js/
│   ├── storage.js         Config (storage keys, cache TTL) + global app state — loads first
│   ├── icons.js            Inline SVG icon library
│   ├── utils.js             ID obfuscation + HTML-escaping helpers
│   ├── player.js             Video player (HLS, quality, seek, speed, fit, fullscreen, theater, PiP)
│   ├── channels.js        Fetch/cache channel list + grid rendering
│   ├── favorites.js       Favorite channels
│   ├── groups.js            Categories, sort, grouped sidebar list
│   ├── history.js           Watch history
│   ├── ui.js                  Toasts, network-stream modal, about/report modals
│   ├── sleep-timer.js     Sleep timer
│   ├── keyboard.js        Keyboard shortcuts + shortcut help modal
│   ├── search.js             Desktop + mobile search
│   ├── splash.js             Splash/loading screen
│   └── app.js                Bootstrap / init — must load last
├── data/
│   └── channels.json      Demo/template channel list (see Configuration)
└── assets/
    ├── icons/
    │   └── favicon.svg    Site favicon (extracted from index.html — was inline data-URI)
    │                      (note: in-app UI icons are still inline SVG in js/icons.js, unrelated to this file)
    ├── logos/             Placeholder — logos come from the remote channel JSON
    └── favicon.ico        Placeholder — legacy fallback for browsers that need .ico (optional)
```

## Architecture Notes

The JS modules are plain `<script>` files sharing a single global scope (no
ES modules / bundler), since several DOM handlers are wired via inline
`onclick="..."` attributes in `index.html`. As a result, **load order in
`index.html` is significant** — several files depend on variables or DOM
references declared by an earlier one. Do not reorder the `<script>` tags
without re-verifying the dependency chain:

```
storage → icons → utils → player → channels → favorites → groups → history → ui → sleep-timer → keyboard → search → splash → app
```

## Credits

Developed by **Jahidul Hassan Parvez** — [Telegram](https://t.me/JahidulXtra)
