# Use the installed collaboration channel

## From an ordinary local Codex session

Read the discoverable team-consult Skill. It distinguishes ordinary terminal sessions from bridge-managed tasks. Installation does NOT automatically connect every open Codex window, inject MCP into existing sessions, or wake them after replies.

For a new managed task, the owner sends a NEW top-level group message mentioning their bot: `新任务：<goal, constraints, expected deliverable>`. Do not reply inside an unrelated topic. The bot returns a task ID and binds its root. Replies belong in that topic.

The local Agent can also explicitly hand off work through the CLI: write a JSON file with `title` and `request`, then provide it as stdin to `node /absolute/runtime/cli.mjs task new`. This queues a NEW managed session in the configured local project, NOT a continuation of the current terminal session. Include current work, decisions, relevant file paths, checks already run, remaining goal and who must decide. Stop the overlapping work in the old session; don't spawn two writers. Use the returned task ID and `task list` to verify creation, not merely process exit. CLI-created tasks don't have a group task root until they open a consultation, so group-created tasks are preferable for visible result tracking.

## Within a managed task

The service injects task-scoped `consult_open`, `consult_revise`, `consult_status` tools and team-consult instructions. Ask a concrete question with context/options/recommendation and the actual approver ID from this bot's identity namespace. Role context is supplied by the service; if identity is unknown, ask for the right person instead of guessing or reusing another app's open_id.

Opening a consultation saves the mapping and pauses dependent work. End the turn rather than polling. Human replies in that consultation topic start a read-only discussion turn in the same managed session. The complete proposal is versioned by the coordinator. Only the designated approver's `/approve C-xxxxxxxx VERSION` for the current version resumes implementation. A question or casual agreement is not an approval. Never implement while still waiting.

## Group controls

- Owner @bot: `查看任务`, `检查连接`.
- Owner in the relevant topic: `暂停这个任务`, `取消这个任务`.
- After personally checking any interrupted effects: `已核对，继续这个任务`; cancellation is permanent.
- Owner @bot: `切换项目：/existing/absolute/path` changes future tasks only.
- Each participant: `/role 我负责…` records their own role, not administrative authority.

Do not mix multiple tasks in one topic. Return actual checks and deliverable links to the correct topic; credentials and private transcripts stay local. Human decision authority doesn't grant machine administration permission.

## Current limits

This release implements human discussion with a managed Codex task. It is NOT yet arbitrary cross-bot messaging: bot-originated messages are ignored to prevent loops, and unsolicited non-owner task creation is restricted. Native attachments and automatic artifact publishing are not implemented. State these limits instead of promising the broader human/AI network already works. The initial terminal session cannot automatically resume without additional integration.
