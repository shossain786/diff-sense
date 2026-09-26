# Marketing assets

- `hero.html` renders `packages/vscode/media/hero.png` (1280x590 at 2x).
- `screenshot-java.png` is a cropped screenshot of the extension (Java test diff + summary panel).

Regenerate:

```
cd docs/marketing
google-chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1280,590 --screenshot=/tmp/hero.png file://$PWD/hero.html
```

For a cleaner screenshot, press F5 (the dev host now starts with other extensions disabled, so no
red squiggles from the Java language server), capture, crop out the window chrome, and replace
`screenshot-java.png`.
