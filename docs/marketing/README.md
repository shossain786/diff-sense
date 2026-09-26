# Marketing assets

- `hero.html` renders `packages/vscode/media/hero.png` (1280x600 at 2x).
- `screenshot-java.png` is a cropped screenshot of the extension (Java test diff + summary panel).

Regenerate:

```
cd docs/marketing
google-chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1280,600 --screenshot=/tmp/hero.png file://$PWD/hero.html
```

For a cleaner screenshot, press F5 (the dev host now starts with other extensions disabled, so no
red squiggles from the Java language server), capture, crop out the window chrome, and replace
`screenshot-java.png`.

## Brand assets

- `logo-original.png` is the source logo (1254x1254, transparent). `packages/vscode/media/icon.png` is a trimmed 256x256 copy; `logo-512.png` is used by the hero.
- `concept-art.png` is an **illustration**, not a screenshot. It shows UI that does not exist in the extension (an "Analysis / Summary" tab bar, a "Driver Initialization" card, an `@Page` example). Do not use it as a Marketplace screenshot or in feature claims; it is fine for a brand or social card if labelled as an illustration.
