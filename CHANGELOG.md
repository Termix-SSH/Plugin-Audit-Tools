# Changelog

## 1.2.0

### Added

- Audit log check: see whether the audit log's hash chain holds, check it now, download its newest hash to keep somewhere else and paste it back later to compare
- Forwarded entries and NDJSON and CSV exports carry each entry's chain hash, so your SIEM keeps its own copy of the head

### Changed

- Needs Termix 26.11.2 or newer

## 1.1.0

### Added

- Alert admins when forwarding to the collector fails and when it recovers

## 1.0.0

### Added

- Forward every audit entry to an HTTP collector as it happens, with an optional bearer token
- Entries written while the collector or Termix was down are sent when it is back
- Export the audit log as CSV or NDJSON from the audit log section, with the viewer's filters
- Move the forwarding settings and the export out of Termix core. Existing forwarding settings and the token are copied over on upgrade
