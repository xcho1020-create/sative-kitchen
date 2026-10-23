# Sative Kitchen

Keep the interface scale and responsive layout approved on 23 October 2026. Extend the existing CSS system instead of redesigning it for routine updates.

- UI language is English, with neutral supplier and manager roles.
- Use black, white, grey and the existing orange `#f09737`.
- Preserve current typography, spacing, content width and mobile control sizes.
- Keep the header and desktop navigation sticky. Mobile navigation remains fixed at the bottom, with safe-area padding. The delivery save bar sits above it.
- Preserve the existing home-screen icons in `public/icons/`. Browser favicons are separate assets.
- Overview defaults to the current month. Sales and estimated gross profit follow the chosen period; outstanding payout balances and operational queues stay global.
- The app and Supabase are the only operational data system. Do not restore Google Sheets integration.
- Keep private supplier costs out of manager responses. Catalogue price or cost changes must not alter historical delivery snapshots.
- For layout changes check narrow phones, larger phones, tablet and desktop widths; verify overflow, sticky controls and long values. Run relevant tests before deployment.
