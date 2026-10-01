# Appport browser demo

Try the Appport catalog with fictional software, users, and devices. Search for
an application, look at available updates, or confirm a simulated install. Changes
last until you reload the page.

The demo runs on its own, without a Relution account or Windows client. It has no
sign-in, credentials, saved browser state, or connection to Relution. Its
content-security policy blocks outgoing connections with `connect-src 'none'`.

## Run locally

Use Node.js 26.5.x and pnpm 11.6.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm demo:build
pnpm --dir apps/web-demo exec vite preview --host 127.0.0.1
```

Open the address printed by Vite. The preview serves the same static build used
for GitHub Pages. For development, `pnpm --dir apps/web-demo dev` starts Vite's
development server, but the strict security policy can block its scripts and
hot-reload connection. Use the production preview when checking the tour.

## Things to try

1. Search for Field Notes and choose MSI in the source filter.
2. Clear the search and choose All sources, then select Install on Drawpad.
   Cancel once, then try again and confirm. Its row moves along the request
   track through Queued, Verifying installation, and Succeeded before leaving
   the list. Cancel or Escape closes the
   dialog and returns focus to the action button. While the dialog is open,
   background controls are excluded from keyboard navigation.
3. Open Updates to compare installed and target versions.
4. Return to Available and try Retry on Image Lab. Archive Room stays locked
   because its example request has an unresolved outcome.
5. Expand Demo support details to see the fictional device information. This
   example does not create a support ZIP.
6. Reload to restore the starting catalog.

The interface uses English or German based on your browser language and follows
your system's light or dark theme. It shares the Windows client's visual system
(see [DESIGN_BRIEF.md](../../DESIGN_BRIEF.md)) and bundles its own copy of the
Atkinson Hyperlegible fonts under the SIL Open Font License.

## Check a change

Run `pnpm demo:verify` for type checks, tests, a production build, and code-quality
checks. It also checks the output for accidental dependencies on native commands,
credential fields, network and storage APIs, source maps, symlinks, or
non-relative entry-point assets.

The [README tour](../../README.md#screenshot-tour) and
[screenshot notes](../../docs/assets/screenshots/README.md) cover the main screens.
These browser checks do not establish native Windows or live Relution behavior.

## GitHub Pages

The [Demo Pages workflow](../../.github/workflows/demo-pages.yml) checks the demo
and publishes only `apps/web-demo/dist`. Relative asset paths let it run under
`/appport/` or a different repository name on a fork.

To publish it from your repository:

1. Open Settings → Pages → Build and deployment and choose GitHub Actions as the
   source. [GitHub's workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
   explains this setup.
2. Put the workflow and demo source on `main`.
3. Run Demo Pages from the Actions tab on `main`, or push a change to a path listed
   in the workflow. Manual runs on other branches are skipped.
4. Open the URL shown by the deployment job. The upstream repository's expected
   address is <https://sebastianspicker.github.io/appport/>.

No Relution credentials or Windows build settings are needed. The build job reads
the repository; only the deployment job has Pages and identity-token write
permissions. Your repository's environment rules may require deployment approval.
