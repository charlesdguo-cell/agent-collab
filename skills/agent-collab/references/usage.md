# Use the installed collaboration channel

## From an ordinary local Codex session

Read the discoverable team-consult Skill. It distinguishes ordinary terminal sessions from bridge-managed tasks. Installation does NOT automatically connect every open Codex window, inject MCP into existing sessions, or wake them after replies.

For a new managed task, the owner sends a NEW top-level group message mentioning their bot: `新任务：<goal, constraints, expected deliverable>`. Do not reply inside an unrelated topic. The bot binds that topic to a persistent local Codex thread. Replies belong in that topic.

The local Agent can also explicitly hand off work through the CLI: write a JSON file with `title` and `request`, then provide it as stdin to `node /absolute/runtime/cli.mjs task new`. This queues a NEW managed session in the configured local project, NOT a continuation of the current terminal session. Include current work, decisions, relevant file paths, checks already run, remaining goal and who must decide. Stop the overlapping work in the old session; don't spawn two writers. Use the returned task ID and `task list` to verify creation, not merely process exit. CLI-created tasks don't have a group task root until they open a consultation, so group-created tasks are preferable for visible result tracking.

## Ordinary group topics

Mention the bot with a question or task. It creates an independent local Codex thread and replies in the same topic; colleagues can continue there. Quoting a known reply keeps the binding. Several exchanges can occur in one topic without losing the session. A finished exchange does not close the topic.

The Agent uses local tools and authorization, and can direct a structured request to a known participant. Bot peers must implement the Agent Collab v1 addressed-exchange contract and have Feishu include-bot permissions. Final replies close only their exchange; receipt messages never invoke the model. Final input can resume dependent local work without sending a bot acknowledgment. Unrelated legacy bots without this protocol are not advertised as supported peers.

Role introductions (`/role area of responsibility`) are stored locally per app/group with source and timestamp; subsequent declarations update them passively. Role prose is not administrative authorization or proof of person/bot linkage.

Existing versioned consultation tasks retain their old explicit approval contract. This is a compatibility path, not the default for new topic conversations.

## Group controls

- Owner @bot: `查看任务`, `检查连接`.
- Owner in the relevant topic: `暂停这个任务`, `取消这个任务`.
- After personally checking any interrupted effects: `已核对，继续这个任务`; cancellation is permanent.
- Owner @bot: `切换项目：/existing/absolute/path` changes future tasks only.
- Each participant: `/role 我负责…` records their own role, not administrative authority.

Keep distinct projects in separate topics; multiple related questions can share a topic. Return actual checks and deliverable links to the correct topic; credentials and private transcripts stay local. Human decision authority doesn't grant machine administration permission.

## Current limits

The core has maintainer-owned real two-bot / local-Codex evidence; this is not multi-machine user acceptance. Claude, native attachments and automatic artifact publishing are not accepted. Existing terminal windows are not automatically attached; a task handoff creates another managed session and must include its context. Do not promise cross-machine execution from a local path.
