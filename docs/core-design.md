# Core collaboration design — revised scope

Status: revised design and scope. alpha.6 implements the core conversational bridge; see alpha6-validation.md for actual evidence and remaining boundaries. This supersedes journey-review priorities where they conflict.

## Installation and acceptance

Installers provide their dedicated self-built bot App ID, local secure App Secret, intended group and local project. Reuse existing resources. The local installation Skill should proactively offer help creating the bot/configuring permissions when the installer is unsure, rather than requiring every installer to perform bot creation. Handle credentials only in the local secure UI.

Maintainers own product testing and release acceptance: actual message exchange, repeated conversation rounds, participant identity and termination. End users are not assigned multi-round developer acceptance, restart or duplicate-delivery exercises. Local automated installation self-check remains part of onboarding, not a user QA assignment. Necessary authentication/organization approval is a user action, not maintainer intervention.

Upgrade and interrupted-install recovery improvements are deferred. Preserve existing safe defaults/data; do not spend the core milestone on new upgrade machinery.

## Agent ownership and capabilities

One person + their own computer + dedicated bot. Bot is a communication endpoint for the actual local Codex, not a canned-answer or approval-only agent. Preserve its available project context and tools within the installer-authorized environment. Do not impose a universal read-only discussion mode or require human approval for every conversation round. Conversely, peer discussion is not authorization to expand host privileges, reveal credentials, or bypass the local Agent's own approval rules. Sender attribution is necessary for the Agent to judge intent and authority.

Use the bound Codex session for existing work; a new topic without an existing task creates an independent conversational session, not an arbitrary latest-task attachment. Explicit handoff is required for an already-running external terminal session that the runtime cannot control.

## Thread and exchange identity

A Feishu topic is long-lived. It may contain multiple sequential or concurrent questions, discussions and consultations. Store group + topic + participant + exchange ID + reply-to event + local task/session mapping. Finishing one exchange must not close the topic or prevent a later new question. A top-level bot mention creates the conversation route; subsequent replies stay in that topic. Resolve quoted messages and fetch bounded prior context when accessible; clarify ambiguous associations instead of guessing.

Messages presented to Codex carry verified platform sender identity/type, mentions, original/quoted text, topic/exchange identifiers, relevant recent history, role-memory facts and local session/task association. The Agent decides whether to answer, investigate, execute within existing authority, consult another participant or finish. The transport handles delivery/dedup/routing, not reasoning.

## AI-to-AI message contract

Use explicit addressed turns rather than "any bot message triggers every bot". A canonical message envelope has exchange_id, message_id, in_reply_to, intended recipients, kind (request/reply/close/receipt), expects_reply, turn_count and deadline. Validate the envelope against the actual authenticated Feishu sender; text claims cannot establish identity. The readable body remains natural language in the same topic.

- request or reply with expects_reply=true addresses the specific next participant and keeps the exchange open.
- final reply/close sets expects_reply=false and closes that exchange. It may carry the final substantive answer but never requests another acknowledgment.
- receipt is transport-only: it never starts model inference and never generates another receipt.
- A recipient consumes close/final information into context without sending polite confirmation. An explicitly new question uses a NEW exchange ID in the same topic.
- Ignore own echoes and duplicate messages. Only deliver a response to its matching outstanding request; a closed exchange cannot reopen from a late retry.
- Enforce a configurable exchange budget/deadline and stop repeated no-progress content. Exhaustion ends automatic back-and-forth with one in-topic explanation; it does not automatically ping another bot or require a human for routine conclusions.
- Concurrent exchanges remain independently correlated. Process writes serially per local execution session; different sessions may run within bounded concurrency.

No human is inherently required to participate in or end an AI-only exchange. Semantic closure is proposed by the Agent; transport-enforced closure prevents infinite acknowledgments even if a model says another polite phrase.

Feishu bot-to-bot event permissions and sender/mention identity must be proven with two real applications before claiming this transport works. Do not replace this test with synthetic sender_type values or role-memory assertions.

## Third-party consultation and private delivery

Default to @ the selected participant in the original topic. Consulting a different peer creates a child exchange, preserving the original waiting exchange and local task/session. Child final results resume that parent and may close it with a substantive answer, without acknowledgement loops. Child handoffs inherit the remaining turn budget/deadline; a new UUID does not reset limits.

Explicit `next.channel="private"` sends through an open_id outbox destination with no group reply root. Store origin task/topic, authenticated peer, delivered private message/chat IDs and parent exchange. Admit private replies only by delivered quote or exact protocol correlation plus verified sender/chat; unsolicited, ambiguous, wrong-chat, late or paused/cancelled routes cannot resume a task. Persist private replay checkpoints separately. Private contact is not permission to disclose unrelated private history. Non-protocol bots must quote the currently delivered question with one final text answer; streaming cards/progress are not supported final-answer signals. Humans may answer a uniquely outstanding same-topic request; unrelated bot messages do not wake the model.

## Local group role memory

Each installation stores private group-scoped data, separate from global personality memory. Suggested key: tenant/app/group, with local participant IDs and verified app-scoped aliases. Records describe person/bot linkage, execution owner, areas of responsibility, who to consult, decision authority (only when explicitly given), evidence message IDs, source, update time and confirmation status.

First join: bounded readable history, self-introduction and one concise request for missing role information. Later updates are event-driven from incoming introductions, corrections, membership changes and explicit owner settings. No periodic role polling. Store only relevant role facts, not indiscriminate group transcripts. A person can correct their own role; uncertain third-party claims remain unconfirmed. Bot/person linkage must be verified through the actual platform and owner pairing, not bot prose. Do not assume open_id is portable between applications.

## Group announcement lifecycle

Read the current docx announcement on startup before the introduction-once guard, and on subscribed bot-added events for the bound group. Refresh before actual jobs after a 60-second TTL, with single-flight reads, timeout and failure backoff; no idle polling or inference triggered by announcement changes. Store text, revision, provenance, read/attempt timestamps and error per app/group. Never replace complete memory with partial, malformed or concurrent-version reads. Successful empty content clears stale text; failures preserve the last good snapshot explicitly marked stale. Include the current snapshot in every conversation and legacy task prompt, including existing sessions. Announcement role descriptions are not verified identity mappings, bot ownership or machine permissions.

## Core milestone gates (maintainer-owned)

1. Local Agent-guided install with minimal human choices/authentication; discovered installation and usage Skills match implementation.
2. Human or bot @ routes to a real local Codex, with correct sender and context, and answers stay in-topic.
3. Multiple exchanges in one topic work; final closes only its exchange; duplicates/late replies/receipts never create loops.
4. Two actual bots complete an AI-only discussion and stop, then answer a new question in the same topic.
5. Group role memory is initially seeded and passively corrected, preserving source/identity boundaries.

Do not mark the tool stable until these core gates have real evidence. Upgrade improvements, complex recovery and installer-performed release QA are not prerequisites for this milestone.


## Result delivery after the dialogue deadline

The ten-minute deadline bounds automatic requests, not research duration or final-result acceptance. An authenticated terminal reply to the exact outstanding request may arrive after the deadline/turn budget and resumes its original task/session once. Further expired questions are retained as `awaiting_final` without scheduling inference; the outstanding request stays correlated. Topic/private-channel, peer and in-reply-to checks still apply, and terminal input cannot open a fresh exchange. Cancellation, pause, uncertain execution and failure never auto-resume.

A terminal response closes the exchange atomically with queuing the continuation. A duplicate message or another final copy cannot run it again. Private replay includes `awaiting_final` exchanges, including after restart. Previously closed exchanges from older versions are not reopened: they may have been intentionally completed or cancelled. Recover their saved evidence under explicit task ownership, not by replaying execution.

`topic status` exposes `activeJobs` and `awaitingResults` (including `deadlineExpired`), independently of stored task state. An empty active queue is not “still researching”; a finished inference is not proof of the parent deliverable. The originating coordinator owns the original deliverable, reuses received findings, checks the artifact and delivery receipt, and reports a real blocker if continuation fails. An unmanaged terminal needs an explicit managed handoff; installing the bridge cannot grant it automatic wakeup.
