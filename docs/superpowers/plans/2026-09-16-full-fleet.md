# Full provider fleet implementation plan

Goal: show every authorized CEM/EQLink machine in the existing dashboard, superseding the exact-LO-only restriction.

Architecture: expand the private provider mapping from a complete bounded inventory snapshot, preserving confirmed LO matches and creating stable provider-prefixed IDs for unmatched devices. Metadata explicitly opts rows into insertion. Never fuzzy-match locations. Read normal THB/calendar-day revenue as before; retain unsupported machines with live status and unavailable revenue. Names and reasons reuse existing UI areas. Never combine non-THB or ambiguous branch totals into baht.

- [x] Add shared mapping/inventory helpers and full-fleet sync script; save only ignored local configuration with rotated CEM token.
- [x] Extend merge and bounded adapters for all configured machines; expose only display metadata, not connection secrets.
- [x] Protect provider-only identities from unsupported GAS mutations; retain the current UI layout and unavailable values.
- [x] Test over-100 inventory, stable identities, metadata insertion/deduplication, unsupported currencies/closing/multi-machine branches, failure behavior and baseline pixels.
- [x] Read live full inventory/revenue, prepare local preview, review, dry-run, update draft PR. No production deployment.

Inventory sync is explicit, not scheduled; rerun when machines are added. Per-request CEM batch size remains five; fleet cap 500 (100 batches). EQLink currently supports at most100 devices and fails closed beyond that existing limit.

Verified discovery: CEM126 branches,124 actual machines (2 empty); EQLink60. CEM default pagination overlaps records, so limit500 plus exact count/unique validation is used. Mapping secrets split into ordered <=4KB chunks, max24 per provider, within Worker secret size/count limits. Local preview uses a private read-only report snapshot; no production deploy.
