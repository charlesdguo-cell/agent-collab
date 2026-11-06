# alpha.12: accept late final results without restarting dialogue

Fixed a research handoff failure: an exact final result arriving after the exchange's ten-minute deadline was stored but discarded before continuation. The deadline now bounds additional questions only; an outstanding final is consumed once, preserves the original task/session and can unwind waiting parent requests. An expired nonterminal reply waits for a final rather than destroying the correlation.

Peer, topic, private delivery, in-reply-to, deduplication and terminal no-ping-pong checks remain. Cancelled/paused/uncertain/failed tasks stay stopped. Old closed exchanges are intentionally not migrated into live work; inspect saved findings and continue under an explicit owner.

Local automated validation: 69 Node tests, including expired final at the turn boundary, duplicate terminal messages, wrong-peer/stale-reply rejection, paused/cancelled/failed/uncertain tasks and private reply after a disk-backed restart with expired parent. These are deterministic integration tests, not another machine's acceptance. Installer validation and live deployment are recorded separately.

`topic status` now reports actual runnable jobs separately from outstanding result waits. The conversation prompt requires continuing original deliverables, not substituting a progress promise for a finished result. This does not magically wake an unmanaged terminal or guarantee that a provider never fails; the originating task owner still collects and verifies the deliverable.
