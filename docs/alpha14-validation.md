# alpha.14: owner autonomy, private confirmations and idle upgrades

Adds explicit per-installation owner-autonomy for authorized routine host work, including version upgrades. No global Codex configuration is changed. High-risk actions use durable private owner confirmations; native command/file approval requests are forwarded rather than automatically declined. Only the bound human can grant the exact request in private; replay, wrong-chat, bot and non-owner responses cannot approve. Interrupted native approvals expire.

The installer can stage and upgrade an existing macOS service after its active work finishes. Configuration, credentials, task/session state and pending work remain; activation failures roll back. A queued maintenance worker is not a successful upgrade. Old sandboxed installations still need a one-time independent local terminal bootstrap; another computer cannot grant their OS access by sending a message.

Validation: 79 Node tests, 4 installer tests and 4 maintenance tests, including non-owner/replay/denial/cancellation, native approval waiting, private replay sources, distinct native actions, busy-worker draining, state preservation and rollback. A real local Codex run wrote and reread a harmless file outside its project under the opt-in policy without an approval request. This is local integration, not another user's machine acceptance or a real destructive-action test.

Protocol reference: https://learn.chatgpt.com/docs/app-server (thread policy, developer instructions and command/file approval response methods).
