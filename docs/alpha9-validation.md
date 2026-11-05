# alpha.9 — persistent group announcement context

## Automated checks

- 62 Node tests pass, including announcement single-flight/TTL, failed refresh with stale memory and backoff, timeouts without late overwrite, successful empty content, app/group persistence isolation, existing-install startup, resumed-session context, nested block ordering and malformed/paginated/version-race reads.
- 3 installer regression tests pass. Installation still resolves the newest published release at installation time; no fixed-version instruction was reintroduced.
- Announcement text is external group reference, not local permission, verified identity or bot-owner linkage. Nontext elements/blocks are explicit unread placeholders, not an apparently empty announcement.

## Real local checks

- Approved announcement was published through the official docx group-announcement blocks API and all 17 paragraphs were read back. Subsequent legitimate group edits were preserved, not overwritten; the reader observes the current revision.
- The dedicated Charlee application initially lacked `im:chat.announcement:read`; the scope was enabled through its existing authorized developer console. The same scope was enabled for Kyle's dedicated app without running its listener or accessing his computer.
- The actual installed Charlee service was upgraded while idle, preserving its earlier immutable release, service file, configuration and SQLite snapshot. Startup and doctor read the current live announcement and the database stores its text/version/source.

Private approved content, app-local identities, console/runtime snapshots and live acceptance records remain outside this public repository. Other computers need the updated runtime and read scope; publishing an announcement does not itself update an older local service. Old-format doc announcements are explicitly unsupported rather than silently treated as read. Refresh is startup/event/job driven, not immediate idle push.
