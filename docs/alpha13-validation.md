# alpha.13: do not let known historical messages block reconciliation

Includes alpha.12 late-final continuation. A live event can carry a trusted local bot open_id while Feishu history later exposes only app_id for that exact same message. Previously identity validation ran before deduplication and that already-saved result permanently blocked the history checkpoint.

Reconciliation now deduplicates known platform message IDs in this application before attempting identity normalization. Unseen app_id-only messages still block the checkpoint: the bridge never guesses a bot identity from message text or a foreign app alias.

Validation: 71 Node tests and 3 installer tests. New coverage proves an already-recorded bot message with unavailable historical identity does not block progress or create another job, while an unseen unresolved sender still prevents checkpoint advancement. This is not a claim that every historical sender can be resolved.
