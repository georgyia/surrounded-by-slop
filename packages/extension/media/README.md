# media

- **`slop.svg`** — the command icon (editor title bar). Monochrome and
  `currentColor`-driven so VS Code themes it; do not give it a background.
- **`icon.svg` → `icon.png`** — the marketplace listing icon. Unlike the command
  icon it carries its own background and colours, because it renders on the
  marketplace's own page, not inside the editor's theme.

`icon.png` is generated, and the marketplace requires PNG (it rejects SVG for
the extension icon). Regenerate it after editing `icon.svg`:

```sh
qlmanage -t -s 512 -o /tmp/slop-icon media/icon.svg
sips -z 128 128 /tmp/slop-icon/icon.svg.png --out media/icon.png
```

That renders at 512 and downsamples for clean anti-aliasing. `qlmanage` scales
the document to its declared `width`/`height`, which is why `icon.svg` declares
512 while keeping the 16-unit `viewBox` the artwork is drawn in.

On a machine with librsvg or ImageMagick, `rsvg-convert -w 128 -h 128` or
`magick -background none` do the same job.
