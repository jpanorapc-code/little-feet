# Code layout

`server.js` owns startup, middleware order, sessions and persistence. Route families live in `lib/routes/`; domain helpers live in `lib/helpers/`. Root context getters keep refreshed database state visible to modules. Registration calls remain in their original middleware positions. Do not reorder them without checking authentication and tenant isolation.

`assets/features/` holds existing browser handlers by feature. These classic deferred scripts load before `backup.js`, which owns session state and startup. Global handler names remain compatible with existing markup. This is a controlled extraction, not a framework rewrite or a change to API contracts.

`lib/auth/login-verification.js` serializes sign-in verification while asynchronous scrypt keeps the event loop available. Hash formats and lockout rules remain compatible.

`assets/welcome-clock.js` owns the South African welcome-card clock. It uses `Africa/Johannesburg`, synchronizes from the existing health timestamp, and stops its timer when hidden or signed out. It creates no additional API polling.

Run the full test suite after moving each domain. Module-layout contracts check routes, handler declarations and registration wiring. Browser and responsive tests check real interactions and layout separately.

## Styles and loading

`index.html` owns the actual workspace markup, IDs and inline handlers. Styles previously embedded there now live in `assets/styles/source/`, grouped into eight files in their original cascade order. Run `npm run build:styles` after editing them; `assets/styles/portal.css` is the tracked deployable bundle. Installation also builds it. The browser requests one bundle, rather than eight stylesheets. Keep it between cinematic and ambient styles, and bump its URL version and the service-worker shell version when changing it. The extraction fixture verifies exact styling during this cleanup; intentional future design changes must update that fixture with review.

`assets/map-loader.js` loads the existing pinned Leaflet and clustering scripts, plus integrity-checked map styles, only when the live school map is opened. Concurrent openings share a promise; failed loads can be retried. Closing the map invalidates its existing request token. Spreadsheet and QR tools retain their existing eager loading for import/export and pickup workflows.

Background videos keep their posters, load their source only when playing, and honour motion preferences. Muted audio uses `preload="none"` and begins through the existing sound controls. Large optional artwork is cached when requested instead of being fetched during service-worker installation. Authenticated HTML and API data remain uncached.

`assets/tour-image-loader.js` loads the original tour images within 300 pixels of the viewport, retaining their existing dimensions, alt text and decoding settings. It falls back to normal loading on browsers without IntersectionObserver. Dashboard logo loading is also deferred until visible.

`npm run test:assets` measures a real isolated local server with a browser, cold and warm visits and both motion settings. It requires external test tooling (`NODE_PATH` for Playwright), not a production dependency. Set `LF_ASSERT_ASSET_LOADING=1` to additionally verify no paused media downloads and real on-demand map assets with integrity checks. Timings are local observations; they are not a guarantee of production speed.
