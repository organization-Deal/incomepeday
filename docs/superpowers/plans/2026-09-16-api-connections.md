# Connection reliability implementation plan

Goal: improve the existing Worker/GAS/DKM connections while preserving the dashboard's markup, styles, calculations and interaction flow.

Approach: retain the existing endpoints and GAS GET forwarding contract, add bounded JSON handling and timeouts, and isolate browser transport in one small classic script (also works in file:// demo mode). Replacing the framework or adding a database would add migration risk without solving these failures.

- [x] Reproduce malformed/HTML upstream responses, error caching, cache-key fragmentation, invalid POST inputs and failed DKM responses reported as zero using Node's built-in test runner.
- [x] Update Worker: validated JSON envelopes; 30-second GAS timeout; at most one retry for transient read failures, never retry writes; canonical cache keys; no browser caching; bypass notes cache; keep existing monthly edge TTLs. After rename the browser requests fresh monthly data; edge cache invalidation is local, so other locations keep their existing TTL.
- [x] Consolidate DKM handler outside public assets, cap request size and machine counts, preserve zero versus unavailable, and split browser fleet reads into 20-machine requests with six upstream requests in flight per batch.
- [x] Add browser transport with bounded waits and existing error surfaces. Guard month/detail requests and pending writes so stale responses cannot paint a different selection. Keep all CSS, data calculations and rendering templates unchanged.
- [x] Run automated API and browser tests with synthetic upstreams; compare before/after screenshots and static markup. Validate Worker packaging locally. Do not write production data during tests.

Constraints: Apps Script source and Cloudflare Access configuration are external to this repository. Preserve GAS secret handling and deployment compatibility. No production deployment or main-branch push in this implementation pass.

Validation: 21 Node tests and 9 browser tests passed. Before/after PNGs matched exactly for desktop/mobile dashboard (light/dark) and drawer. Wrangler dry-run succeeded; local workerd served HTML/assets and returned JSON for known/missing API routes. A separate code review found two issues (early notes save, partial fleet chunk errors), both fixed with regression tests and re-reviewed. No production credentials or live writes were used.
