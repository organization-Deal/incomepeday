# Operations workspace and daily notes

User explicitly requests redesign, superseding original pixel-identical UX constraint.
Design: clear section navigation, summary KPIs followed by the four revenue/status categories; analytics below. Category click opens an accessible modal with searchable locations and a daily-note editor. Selecting a location does not lose the category context. Existing detailed drawer remains available. Native dialog supplies keyboard focus containment and Escape; drafts survive switching/closing during this page session.

Daily notes have machine identity, selected calendar date, author and text. Saving must persist and report actual failures, support all provider/LO identities and prevent duplicates on uncertain retries. Preview storage must be labelled local and separate from production. Existing GAS notes remain unchanged.

Verification: all four groups, empty/search states, keyboard, mobile overflow, date selection, reload persistence, stale responses, duplicate saves, server validation and no cross-machine drafts. Recheck provider logic remains untouched. Review and update existing draft PR; no production deployment.
