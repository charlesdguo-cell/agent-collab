# alpha.6 validation scope

Maintainer validation, 2026-11-06. This is a core collaboration preview, not a claim of completed multi-machine user installation.

- 43 automated Node tests: new conversational routes, cross-app bot aliases, first-topic context, serial sessions/concurrent topics, terminal continuation, duplicate/late/receipt handling, controls, legacy consultation compatibility, subprocess/MCP/setup tests.
- 3 installer regression tests; both Skills pass structural validation.
- Real installed Codex app-server handshake/account check and two-turn persisted thread recall.
- Real Codex tool execution in an isolated scratch project: created and read back a file under inherited local authorization, with no permission override.
- Two independent real Feishu application bots, each connected to its own real local Codex thread: clarification exchange, final answer, quiet closure, then a second question under the same topic. Six addressed messages; three completed jobs per participant; two exchanges per participant closed. Both participants retained their own thread ID.
- Real platform event sender type and application-local IDs verified. Sender-local recipient aliases are not equal to receiver-local self IDs; admission uses the platform mention and sender.
- Real topic-root read succeeds. When reply-history permission is absent, the root remains available and missing replies are marked partial. The setup guide requires group-history permissions; the doctor now fails when directory/history prerequisites are unavailable. This does not prove the event subscription or model job merely from a passing doctor.

Private raw event logs, bot credentials and Codex transcripts are excluded from this repository. Tests used a maintainer's isolated projects, not a user's actual installation or project. No existing user's bot listener was started.

Known boundaries: peers need the same addressed-exchange protocol; no automatic attachment of existing terminal sessions; no verified cross-app person/bot ownership just from names; no completed Claude/attachment/automatic-artifact-publication acceptance. Upgrade and advanced recovery are deferred. Historical bot messages exposing only an app ID are not guessed into a local open_id or silently replayed as a trusted peer.
