# Daily online hours

User requirement: count machine online duration per Bangkok calendar day, 00:00 through 23:59:59.999, instead of treating a snapshot as an entire day.

Implemented:
- Server-only status sampler every five minutes, independent of page views and revenue reads.
- CEM chunks of five, concurrency two, serialized through the existing session coordinator. Each background RPC has a ten-second total budget including token refresh, below the interactive queue's fifteen-second wait limit.
- EQLink uses its complete device-list read. Read failures / unknown device status remain unknown. No device controls or payments are invoked.
- Durable, transactional per-machine/day totals. Duplicate and out-of-order observations do not add time. Previous observed state applies until the next successful observation, only if both states are known and the gap is at most ten minutes. Thus hours are explicitly estimates; rapid changes between polls cannot be reconstructed.
- Intervals split exactly at Bangkok midnight. Before first observation, after last observation, errors and long gaps remain unknown. Future time is excluded from today's denominator. A single snapshot never establishes hours.
- Popup and drawer offer an independent date picker and online/offline/unknown duration. Old snapshot percentages are labelled as snapshot ratios, not hours.
- GET-only public API behind the existing Cloudflare Access perimeter; collection writes are available only through internal Durable Object RPC.

Operation:
- New ONLINE_TIME SQLite Durable Object and migration. Deployment activates the five-minute Cron Trigger with ONLINE_TIME_ENABLED=true. Set that variable to false to stop collection without deleting totals.
- No production deployment performed. Local preview has no collector/history and says so. Existing revenue and notes remain untouched.
- Current 124 CEM / 60 EQLink fleet: approximately 127 provider read requests per five-minute cycle (124 branch reads, three EQLink authentication/vendor/list calls), plus occasional CEM refresh. About 36,576 calls/day. At most two simultaneous CEM reads. Provider-specific rate limits have not been published/verified; failures are surfaced as missing data, without retry storms.
- Parent invocation at current fleet: 25 CEM RPCs, two ledger RPCs and three EQLink requests, plus no external fingerprint calls. Collector explicitly rejects more than 200 CEM devices before making any calls (at most 40 CEM RPCs + two ledger RPCs + three EQLink requests). The inventory/dashboard can support more, but collection must be sharded before expanding beyond this cap.
- Four-minute sampling deadline stops further CEM network calls; skipped machines get UNKNOWN observations. Logs contain only accepted/unknown counts and elapsed duration. Unexpected top-level failures fail the scheduled invocation.
- Storage grows by at most one day record per machine per day plus latest-state records (~67,160 day records/year for 184 machines). No automatic deletion of history.

Validation: midnight rollover, flapping, duplicate/concurrent writes, missing history, gaps/errors, current-day denominator, invalid timestamps/date/code, status-only provider reads, disabled/error collector, read-only API, browser date-race handling, existing regression suite, Worker dry run and local SQLite/RPC integration.

## Daily activity summary clarification

The machine table and popup list now lead with whether online activity was observed today and cumulative hours/minutes, followed by the separate latest snapshot. A single ONLINE observation establishes “seen online” but cannot establish duration; a later OFFLINE observation does not clear that fact. Missing history says unconfirmed, and offline-only observations say no online activity observed in the collected period, never “offline all day.” A shared 30-second browser cache loads configured fleet day summaries in one ledger RPC without calling provider APIs.

Latest ONLINE and OFFLINE observation timestamps are retained independently across midnight and UNKNOWN/ERROR reads. They are global machine history, explicitly labelled separately from the selected day's hours. These timestamps mean last observed by the five-minute sampler, not exact state-transition times. Missing observations display no recorded history.

## Verified CEM source history

CEM's machine detail UI calls `/api/restrict/machine/state-history/{mac}?page=1&limit=100&project=qrbox`, with `result[].state` and timezone-qualified `record_at`, newest first. The adapter resolves the MAC only from the matching device ID in its configured branch, then validates pages and timestamps. It reads at most three pages per machine until both latest states are found; otherwise marks incomplete. Source transition timestamps live in separate `source:<code>` records, never overwrite sampling timestamps or manufacture duration totals. The UI labels source transitions separately. All current statuses are read before optional history to preserve daily-hour coverage when history is slow. Failed history reads retain the previous valid source result and produce an explicit count in collector logs.

Observed account import: all 124 CEM machines returned both timestamps; EQLink's verified list/shadow endpoints expose current state and generic update times, not a verified pair of state transitions. The 60 EQLink rows therefore retain explicitly labelled dashboard observations. No generic update timestamp is presented as an online/offline transition.

Current-fleet normal sampling now makes about 251 provider reads per cycle (124 CEM branch + 124 history + three EQLink), or 72,288/day plus occasional refresh. Worst case per CEM batch: five current-status + fifteen history reads, bounded by the same ten-second budget. No automatic network retries in scheduled operation. `node scripts/sync-source-status.mjs` performs an authorized local import to ignored `.local-data/online-time.json`, with at most one extra attempt for locally failed machine histories; it does not deploy or write production data.
