# JetBrains Marketplace images

- `original-json.png`, `original-java.png`: your untouched screenshots from the IDE.
- `screenshot-*.png`: the same with the IDE title/toolbar row cropped off (nothing else retouched).
- `card-hero.html`, `card-diff.html` (generated from `template.html`) render `packages/intellij/media/intellij-hero.png` and
  `intellij-diff.png` (1280x855 at 2x). The plugin description in `plugin.xml` links to them on GitHub, and they can also be uploaded
  under Screenshots on the Marketplace page.

Regenerate after retaking a screenshot (replace `original-*.png`, crop the top 60px into `screenshot-*.png`):

    google-chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=2 \
      --window-size=1280,855 --screenshot=/tmp/hero.png file://$PWD/card-hero.html

The screenshots were taken before the summary table layout fix. Retake them with the current build for the best result.
