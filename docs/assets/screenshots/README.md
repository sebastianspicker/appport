# README screenshots

The [README tour](../../../README.md#screenshot-tour) shows the browser demo running
in Chromium 153 with Playwright 1.62.1 on macOS. All software, user, device, serial,
and network details are fictional. These captures show the browser interface;
they do not establish native Windows behavior.

## Capture settings

Use a 1440 × 820 viewport, a device scale factor of 1, English (`en-US`), and reduced
motion. Use light mode except for the Updates screenshot. Fonts may look different
on another operating system.

| Image | What to capture |
| --- | --- |
| [Available](available.png) | Initial Available catalog, all sources, empty search |
| [Updates](updates.png) | Initial Updates catalog in dark mode |
| [Confirmation](confirmation.png) | Drawpad's Install confirmation, with Cancel focused |
| [Support](support.png) | Initial Updates catalog with Demo support details expanded |

## Refresh the tour

From the repository root, check and preview the demo:

```sh
pnpm demo:verify
pnpm --dir apps/web-demo exec vite preview --host 127.0.0.1
```

Open the address printed by Vite in Chromium and apply the capture settings above.
Reload the page before preparing each screenshot so previous actions do not change
the catalog. Save the viewport captures using the existing filenames, then review
all four images in the README.

Check the interface at a narrow width too. The current tour was also checked at
390 × 844. Exercise search, source filters, empty results, the locked example, and
support details. For an install, check Cancel and Escape, then confirm and watch
Queued, Verifying installation, and Succeeded. The completed card should disappear, and a reload
should restore it.
