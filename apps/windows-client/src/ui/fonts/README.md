# Bundled fonts

Appport sets language in Atkinson Hyperlegible Next and machine strings (versions,
action IDs, serials, device names, labels) in Atkinson Hyperlegible Mono. Both were
designed for character disambiguation (0/O, 1/l/I), which matters when people read
identifiers aloud to IT. The files load from the application itself, with Segoe UI
and Cascadia Mono as fallbacks.

| Font file | Source | License |
| --- | --- | --- |
| `atkinson-hyperlegible-next.woff2` | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegiblenext), variable weight 200–800 | [SIL Open Font License](atkinson-hyperlegible-OFL.txt) |
| `atkinson-hyperlegible-mono.woff2` | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegiblemono), variable weight 200–800 | [SIL Open Font License](atkinson-hyperlegible-OFL.txt) |

Both files are subset to Basic Latin, Latin-1 (including German umlauts and ß),
general punctuation, and arrows, and converted to WOFF2 with fontTools:

```sh
pyftsubset <font>.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2190-2199,U+2212,U+2215,U+20AC,U+2122,U+25B8,U+25B6,U+2713,U+FEFF,U+FFFD" --layout-features='*' --flavor=woff2
```

Both families share one license text. Keep it with the fonts when packaging the
application.
