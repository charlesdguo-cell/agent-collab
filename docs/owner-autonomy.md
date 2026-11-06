# Owner-authorized execution and native approvals

Routine local work, dependency installation, version updates and reversible configuration changes within an authorized task are not high risk merely because they need a path outside the project or ordinary network access. The owner may opt this one installation into `executionMode: owner-autonomy`; the bridge supplies full-access thread policy with on-request approval. This does not edit global Codex configuration or override administrator requirements. Existing installations retain inherited policy until that owner opts in.

Alpha.15 removes the additional semantic risk-classification and `confirmation` output introduced in alpha.14. Ordinary topic turns use `{reply,next}` and complete installer-authorized work directly. This also replaces old instructions when an existing thread resumes. The bridge does not promise independent business-risk classification or universal pre-action human review. Existing alpha.14 confirmation records remain readable and their exact owner decisions still resume the original task; migration does not turn unanswered requests into approvals.

Native command/file approval requests also use the private owner path and await an explicit single-action decision. These preserve the currently suspended tool call instead of starting a second job. Interrupt/restart invalidates native approvals; a stale yes cannot authorize a different future command. The normal 15-minute model-turn budget still bounds a native pending prompt. MCP forms, permission-set grants and unknown dynamic tools remain non-grant unless implemented explicitly; no fabricated answers or blanket approval callback.

## Upgrade lifecycle

The public installer supports staging without activation (`--stage-only`) and configured-service upgrade (`--activate-upgrade`). It starts a separate maintenance process which sets draining, waits for active jobs, retains a SQLite write lock across the final idle check and shutdown (including older runtimes), snapshots state/config/plist, switches the versioned runtime, and restores the prior selection on activation failure. Pending tasks are preserved. A dead maintenance process is detected by the new runtime so it does not leave scheduling permanently drained. Inspect `maintenance-status.json`; a queued request is not a successful upgrade.

Use the actual home/root/service label for the installation. A process cannot use this feature to bypass its inherited OS sandbox. Old sandboxed installations need a one-time owner-authorized independent terminal bootstrap with `--activate-upgrade --enable-owner-autonomy`; after that, the new policy and maintenance flow handle ordinary upgrades. Never substitute another person's machine or stop an active model turn to claim success.

After this version is installed, authenticated private owner commands `开启自主执行` / `恢复默认执行权限` persist the per-installation mode for future turns; group/bot commands cannot change it.
