# Changelog

## 1.0.0

### Added

- Forward every audit entry to an HTTP collector as it happens, with an optional bearer token
- Entries written while the collector or Termix was down are sent when it is back
- Export the audit log as CSV or NDJSON from the audit log section, with the viewer's filters
- Move the forwarding settings and the export out of Termix core. Existing forwarding settings and the token are copied over on upgrade
