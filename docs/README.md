# Spend Log

A spending tracker built to clear one bar: **logging a spend takes under five
seconds.** Type the amount on the keypad, tap a category, done. That's the whole
interaction — no date picker, no account field, no required note, no sign-in.

It's a Progressive Web App, so it installs to your phone's home screen and runs
offline, but it's just HTML, CSS and JavaScript — no build step, no dependencies,
no framework.

## Putting it on your phone

1. In the repo, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick branch `main` and folder **`/docs`**, then **Save**.
4. Wait a minute, then open `https://<your-username>.github.io/claude-code-practice/`
   on your phone.
5. In Chrome, tap the **⋮** menu → **Add to Home screen**. On iOS Safari, tap
   **Share** → **Add to Home Screen**.

It then opens full-screen with its own icon, and works with no signal.

## How it works

Your data never leaves the device. There is no server, no account, and no
network request after the first load — the app stores everything in
`localStorage` under the key `spendlog.v1`.

That's the privacy upside and the durability downside: **clearing your browser
storage erases your history.** Export from Settings now and then. The export is
plain JSON, and the import will take it back.

### Money is stored in integer cents

Never floats. `0.1 + 0.2 !== 0.3` is a rounding curiosity in most programs and a
wrong number in a spending tracker, so amounts live as whole cents everywhere and
are only formatted for display.

### The keypad has no decimal point

Digits accumulate from the right: tapping `1` `2` `5` `0` gives `12.50`, and a
lone `5` is five cents. This is how fast expense apps work — the decimal key is a
tap you never have to make.

## Files

| File | Role |
|---|---|
| `index.html` | markup and the three views |
| `styles.css` | design tokens, light and dark |
| `core.js` | all pure logic — money, dates, aggregation, import validation |
| `app.js` | DOM wiring; the only file that touches the document or storage |
| `sw.js` | service worker, stale-while-revalidate app shell |
| `manifest.webmanifest` | PWA metadata for install |
| `icons/make_icons.py` | regenerates the icons (needs Pillow) |

`core.js` is deliberately free of DOM access so it can be tested under node:

```bash
node --test "tests/**/*.test.js"
```

## Colors

The palette follows a validated data-visualization reference: one accent hue
(`#2a78d6` light, `#3987e5` dark, both checked for lightness band, chroma and 3:1
contrast against their surfaces), text in neutral ink tokens, and a recessive
gridline for the bar tracks.

The month chart is a magnitude comparison, so it uses **one hue and lets bar
length carry the value** rather than coloring each category differently. Category
identity comes from emoji instead — which keeps the chart honest, sidesteps the
problem that nine hues can't stay distinguishable under color-vision deficiency,
and means every bar is directly labelled with its own name, value and share.
