# Use the installed collaboration channel

## From an ordinary local Codex session

Read the discoverable team-consult Skill. It distinguishes ordinary terminal sessions from bridge-managed tasks. Installation does NOT automatically connect every open Codex window, inject MCP into existing sessions, or wake them after replies.

For a new managed task, the owner sends a NEW top-level group message mentioning their bot: `新任务：<goal, constraints, expected deliverable>`. Do not reply inside an unrelated topic. The bot binds that topic to a persistent local Codex thread. Replies belong in that topic.

The local Agent starts a visible topic directly, without asking the user to send a group message:

1. Read `topic members` for receiver-local bot IDs and role records. Match the intended name; clarify ambiguity rather than guess. Never reuse IDs from another app.
2. Write a JSON file `{ "requestId": "unique-stable-id", "title": "short topic", "request": "complete context, goal, constraints, intended colleague and what to ask" }`. Submit its contents on stdin to `node /absolute/runtime/cli.mjs topic start`. Reuse the same requestId and exact request if submission outcome is uncertain. Do not put credentials or unnecessary private context in this file. The request may be shared with the intended collaborators as needed.
3. The returned task is queued, not yet delivered. `topic status TASK` reports actual root message, jobs and latest messages. A root is bound only after successful group delivery. The background service must be running.
4. To add to that topic, submit `{ "task": "T-...", "requestId": "another-stable-id", "request": "follow-up" }` on stdin to `topic reply`. It keeps the managed Codex thread. `topic status TASK` lets the initiating terminal read results and continue its own work. Waiting must be bounded; no claim of automatic terminal wakeup.

The bridge-managed Codex session is separate from the current terminal session. Give it sufficient context; do not run overlapping file writers. For consultation-only handoff, explicitly say to investigate/discuss and return conclusions, leaving implementation with the initiating terminal. Legacy `task new` retains the older approval workflow and is not the default collaboration entry.

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
