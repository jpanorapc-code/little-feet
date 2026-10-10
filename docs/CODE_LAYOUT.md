# Code layout

`server.js` owns startup, middleware order, sessions and persistence. Route families live in `lib/routes/`; domain helpers live in `lib/helpers/`. Root context getters keep refreshed database state visible to modules. Registration calls remain in their original middleware positions. Do not reorder them without checking authentication and tenant isolation.

`assets/features/` holds existing browser handlers by feature. These classic deferred scripts load before `backup.js`, which owns session state and startup. Global handler names remain compatible with existing markup. This is a controlled extraction, not a framework rewrite or a change to API contracts.

`lib/auth/login-verification.js` serializes sign-in verification while asynchronous scrypt keeps the event loop available. Hash formats and lockout rules remain compatible.

`assets/welcome-clock.js` owns the South African welcome-card clock. It uses `Africa/Johannesburg`, synchronizes from the existing health timestamp, and stops its timer when hidden or signed out. It creates no additional API polling.

Run the full test suite after moving each domain. Module-layout contracts check routes, handler declarations and registration wiring. Browser and responsive tests check real interactions and layout separately.
