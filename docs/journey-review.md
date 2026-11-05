# End-to-end journey review — alpha.5

Historical audit. The current implementation target and scope are in [core-design.md](core-design.md); notably universal read-only discussion, user-run release QA and upgrade priority are superseded.

Review scope: installer-Agent walkthrough, human effort, source-level admission/context/response routing. Synthetic messages were passed through the real Store/Service implementation; this is not live Feishu latency or model-comprehension validation.

## Verdict

Not ready to claim the intended general human/AI collaboration network. Two Skills and an installable package are necessary, not sufficient. Human-to-managed-task consultation is the implemented narrow lane. Normal group mentions, non-owner discussion in task threads, bot-to-bot communication and arbitrary terminal session integration are incomplete.

## Installer Agent journey

The guides now specify a pinned source, receipt, two discovery links, local configuration, identity pairing, service startup and verification. Fresh/repeat installs and dependency-failure recovery have tests. Remaining gaps:

- Prerequisites and Feishu console automation are instructions rather than deterministic helpers. Agent tool availability varies; a text-only Agent cannot perform all browser steps.
- Current guidance can overburden a new user with developer acceptance (three rounds, restart/cancel/duplicate tests). Separate basic onboarding from product release acceptance. The latter remains required evidence, but is not a checklist every installer must manually execute.
- No concise phase checkpoint/status entry exists across setup/credentials/service/group proof; a returning Agent must reconstruct state.
- Configured-service upgrades stop without a supported upgrade mechanism. This contradicts effortless subsequent maintenance.
- The currently running installer Codex is not the managed execution session. Explicit context handoff is necessary, with no overlapping writers; this must be demonstrated to the user, not hidden.

## Human journey: minimal interaction contract

1. Give the installation instruction to a local Agent. It inspects environment, downloads, validates, installs, and prepares known non-secret fields.
2. Ask once for missing choices only: desired group/project/bot. Reuse supplied information; selecting a project or group is a choice, not an authentication requirement.
3. Local Agent handles console setup where authorized tools allow. Human authentication and organization approval are truly human-only. Secret entry remains in a secure local UI; never ask the user to transfer it through chat.
4. Pair once in the exact bot's private chat. This proves the actual human sender. Do not substitute a bot-originated or forged event.
5. One group interaction proves the real inbound/outbound path. Then demonstrate an actual consultation and version confirmation in that same topic. Agent inspects persistence and evidence itself; do not ask users to read IDs, inspect SQLite or run commands.

Give each unavoidable action a short instruction: destination, single action, success indicator. Do not dump the entire developer console checklist at once. If local browser access is unavailable, acknowledge that more user clicks are required; do not advertise unconditional zero-touch setup.

## Message-routing probes and findings

- A human's unbound @ mention returns generic commands; no Agent answer/context session is created.
- A non-owner's question in a bound TASK topic returns generic commands; only CONSULTATION topics admit their discussion.
- A human's question in a consultation queues a read-only discussion on the exact task; final response targets the same consultation root. No immediate acknowledgment is queued.
- Bot-originated consultation mentions are ignored outright.
- Quoting a task's bot answer with only parent message ID fails task resolution. Consultation answer mapping exists; task answer mapping does not.
- An owner's question in a ready/done task topic queues `execute`, even if it merely asks for an explanation.
- The service uses a single pumping flag across tasks, so a long model turn can delay another topic's answer. A two-second tick is not a response-time guarantee.
- Consultation prompts include original session, current proposal, sender and recent mapped messages. Unbound quoted history is not recovered and ordinary task-thread discussion does not get that same context package.
- Failure messages for non-consultation jobs may fall back to the group root rather than the originating task topic.

## Target interaction design

Separate conversation identity from execution authority. Addressing a bot can create/continue a conversation without authorizing code execution. Bind app/group/topic/message to that conversation, with optional task/session linkage. Don't choose the latest session on ambiguity. Unbound context should be fetched in bounded form where available or clarified in-thread.

Use a quick durable acknowledgment with task/conversation identity before model processing, coalesced to avoid noise. Answer in the originating topic and retain reply mappings for both task and consultation messages. Keep discussion read-only; task creation, mutation, approval and owner controls are distinct actions. Serialize per execution session, with bounded cross-session concurrency, rather than blocking every topic behind one job.

Bot-to-bot support needs authenticated participant registration, correlation/reply IDs, deduplication, reply/turn budgets and explicit termination. Removing the bot filter alone is not an implementation.

## Fix/acceptance order

1. Ordinary human @ and same-topic multi-round read-only discussion, including non-owner and quoted replies; correct error placement and prompt context.
2. Timely receipt/queue visibility and scheduling isolation; measure with real transport/model rather than infer timing from tick interval.
3. Minimal-human onboarding phases/checkpoints and supported existing-service maintenance.
4. Cross-bot transport/identity and loop controls, followed by real multi-participant acceptance.

Do not invite additional testers as though V1 passed until the user-agreed acceptance gate is met. The alpha.5 limitations remain current until implemented and verified, not merely documented here.
