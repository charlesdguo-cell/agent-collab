---
name: agent-collab
description: Install, configure, diagnose and verify this computer's Agent Collab Feishu bridge for Codex tasks and team consultation. Use for Agent Collab onboarding and local bridge management.
---

# Local Agent Collab

Resolve this Skill symlink to its concrete release. Runtime root is two parents above the resolved Skill directory. Use that root's `cli.mjs`; never assume the shell's current directory or download a new version during a task.

Each person binds their own execution computer and dedicated bot. The binding is not a restriction on conversation partners. Do not run another person's bot here to simulate their installation. Never share an active bot listener between computers.

Before setup, read [Feishu setup](references/feishu-setup.md). For a failure read [troubleshooting](references/troubleshooting.md). After setup, read [daily usage and task handoff](references/usage.md), and teach the user ordinary @ and same-topic conversation. These references are bundled; no maintainer instructions are needed.

## Setup and automatic self-check

1. Proactively ask whether the dedicated bot is ready and whether the installer wants help creating it or configuring permissions. Reuse supplied IDs; do not ask again for known information. Inspect existing configuration metadata without printing `appSecret`. Confirm the user's local project. Preserve existing configuration/service and continue from its actual phase; don't overwrite or restart blindly.
2. For first setup, run `AGENT_COLLAB_INSTALL=1 node /absolute/runtime/cli.mjs setup` as a background process. It opens a localhost page. The user supplies App ID/Secret there, selects Codex and their local project, and pairs through the bot's private chat. Use the group link from the user. Do not copy secret values into model prompts, shell text, messages or diagnostics. With suitable local browser tools, assist non-secret fields; otherwise guide the exact remaining action.
3. The dedicated self-built bot must join the group, have message send/history/group-receive permissions, and subscribe to `im.message.receive_v1` through long connection. Use the user's authorized console to configure if possible; otherwise identify the precise required console step. Do not infer setup success from the bot appearing in the group.
4. Check `codex login status`; reuse valid login. Install Codex if absent using its official distribution. Ask the user to authenticate only when the actual local check fails. Do not change unrelated global MCP settings or disable approvals.
5. Run `node /absolute/runtime/cli.mjs doctor`. Then, on macOS, install the background service using `install-service` only if no existing service is present and this bot has no active listener elsewhere. Check launchd status and bounded, redacted errors. Do not retry an uncertain bootstrap blindly.
6. Complete the automatic local checks and report any specific failure. Release QA belongs to the maintainer: do not assign users multi-round discussions, restart, cancellation or duplicate-delivery exercises. A user may start normal use by @mentioning their bot; do not block completed installation on a user-run QA script.
7. Report observed stages, actual execution computer, version, group/thread, and remaining failures. Installed is not configured, service-running is not message delivery, and model job-done is not consultation success. Never mark real user acceptance from mock tests.

## Day-to-day diagnosis

Use `doctor`, `topic status TASK`, `task list`, and the configured service's bounded local logs. Do not publish config files or entire conversation databases. First check identity, device, bot, group, original task/session and message/thread mapping. Do not put ambiguous replies into the most recent session.

For ordinary topics the runtime supplies the collaboration output contract and context. Legacy managed tasks additionally receive the team-consult Skill and task-scoped MCP tools. This management Skill does not give an arbitrary terminal session automatic async wakeup. If the task is not managed, establish a managed task explicitly rather than claiming its terminal session can be resumed.

Codex topic conversations and bounded AI exchange have maintainer integration evidence; do not call a handshake, mock test, or another computer a successful user installation. Claude, native attachments and task-artifact automatic publishing remain unverified or incomplete. No automatic public upload of local projects. Never invite other testers or send team-wide onboarding messages without the user's instruction.

For an explicitly authorized separate local identity while another disabled installation must be preserved, use a separate runtime root, Skill directory and `AGENT_COLLAB_HOME`. `AGENT_COLLAB_SERVICE_LABEL=ai.ikigen.agent-collab.NAME` selects a distinct launchd label. Never reuse the other identity’s credentials or overwrite its plist. Record these paths for the local Agent.
