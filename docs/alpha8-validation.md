# alpha.8 — third-party consultation

## Verified

- 54 automated Node tests pass, including child→parent return, nested clarification unwinding, inherited budget/deadline and ancestor termination.
- Exact private delivery correlation persists across restart and reversed replies from the same recipient; stale quotes, consumed requests, wrong sender/chat/channel, failed sends and cancelled tasks cannot resume unrelated work.
- Real Charlee-bound macOS service deliberately upgraded while idle, preserving alpha.7, its plist, configuration and SQLite snapshot. No Kyle listener runs on this computer.
- Real Feishu original-topic @mention and private text delivery were read back with matching destination/content (platform-normalized mention representation accounted for).
- Real local Codex resumed the existing topic session under the new output schema, completed and delivered its recovery confirmation in the original topic.

## Evidence boundaries

Chained three-party and private response-routing coverage above is automated integration testing with synthetic messages, not a three-machine user acceptance test. Real private outbound delivery is verified; a human private reply resuming the original task has not yet been accepted. Nonprotocol bots must quote the current request and return one final text reply; progress/streaming cards are not a completion protocol. Bot-to-bot private delivery depends on Feishu support. Existing configured services on other computers do not update automatically.

Private runtime snapshots, app-local member IDs and raw conversation records are kept outside this public repository.
