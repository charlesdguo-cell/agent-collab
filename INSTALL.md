# Install Agent Collab with your local Agent

You are the installing Agent on the user's own computer. Complete the workflow, not just a download. No remote access to a maintainer's machine is required. Current supported acceptance target: macOS + Codex, Node.js 24+ and Python 3.9+.

1. Read the user's project instructions. Confirm the actual computer and desired local project directory. Check existing `~/.local/share/agent-collab`, `~/.agents/skills/agent-collab`, `~/.agent-collab` and launchd service without printing secrets. Preserve existing installs; do not launch a duplicate bot or overwrite a configuration.
2. At installation time, query the PUBLIC GitHub Releases API and select the most recently **published, non-draft release**, including prereleases while this project is in preview. Do not hard-code a version from a chat message, an old guide, a cached checkout or an example. Clone that release's returned tag into a new directory without credentials, and record its release URL, tag and `git rev-parse HEAD`. If release discovery fails, report the concrete failure rather than silently installing a guessed or cached version. This live main-branch guide owns version selection; an older pinned INSTALL.md inside the selected release must not override it. After selection, keep the same resolved release throughout this installation rather than changing versions mid-task.

   One credential-free way to resolve and clone the current release (Python 3 and Git required):

   ```python
   import json, re, subprocess, tempfile, urllib.request
   request = urllib.request.Request(
       "https://api.github.com/repos/charlesdguo-cell/agent-collab/releases?per_page=100",
       headers={"Accept": "application/vnd.github+json", "User-Agent": "agent-collab-installer"})
   with urllib.request.urlopen(request, timeout=30) as response:
       releases = json.load(response)
   published = [r for r in releases if not r.get("draft") and r.get("published_at")]
   if not published:
       raise SystemExit("No published release found; do not guess a version")
   release = max(published, key=lambda r: r["published_at"])
   tag = release["tag_name"]
   if not re.fullmatch(r"v[0-9][A-Za-z0-9._+-]*", tag):
       raise SystemExit("Unexpected release tag; inspect before cloning")
   checkout = tempfile.mkdtemp(prefix="agent-collab-source-")
   subprocess.run(["git", "-c", "credential.helper=", "clone", "--branch", tag,
                   "--depth", "1", "https://github.com/charlesdguo-cell/agent-collab.git", checkout], check=True)
   print("Source:", checkout, "Release:", release["html_url"], "Tag:", tag)
   subprocess.run(["git", "-C", checkout, "rev-parse", "HEAD"], check=True)
   ```

   Read the selected source before executing its installer. Do not copy code from an unrelated local project or install a moving development branch in place of a published release.
3. Check `node --version`, `npm --version`, `python3 --version`, `codex --version`, and `codex login status`. Reuse valid existing Codex login. If Node 24+ is missing, install an official Node distribution for the actual OS/architecture and verify its published SHA-256 first. Never disable TLS or system security. If tooling cannot be installed under the Agent's permissions, report the precise missing prerequisite.
4. In the checkout run `python3 scripts/install.py`. It installs a versioned runtime and a stable Skill link, but DOES NOT configure credentials, start the bot, or claim acceptance. Existing differing installations are preserved rather than overwritten.
5. Read the installed `~/.agents/skills/agent-collab/SKILL.md` and continue its setup and automatic self-check steps in this same session. If a fresh Agent session is needed for Skill discovery, it can still read the file directly now.

The installation needs the user's dedicated Feishu self-built application bot, group, and local project. Use an existing dedicated bot if supplied; do not make a second bot or share an active event listener. Guide necessary console permissions/login locally. Credentials belong only in the loopback setup page, never in chat, shell arguments, or shared logs. If human action is indispensable, ask for that one action and resume from the saved phase, without repeating completed setup.

Report stages separately: runtime/Skill installed → identity/config verified → service running; live group behavior is release QA owned by maintainers, not an installer assignment. Public access is not evidence of any later stage. Record the exact blocker if not all stages pass.


## Continue without a maintainer

The installed management Skill links to `references/feishu-setup.md`, `references/troubleshooting.md` and `references/usage.md`. Read the relevant reference, diagnose on THIS computer, and complete the next stage. Do not send the user to the package author as a normal installation step. If the Agent cannot use a browser or send a human-identity message, guide that minimal user action locally; no maintainer intervention or remote access is required.

Both `agent-collab` (installation/management) and `team-consult` (ongoing collaboration) are installed under the chosen skill directory. Verify both links resolve and read both Skills now; new sessions discover them automatically where supported. Installing a Skill does not attach the currently running Codex session to the bridge: the usage guide describes explicit task handoff.

For an existing installation, after selecting the current published release, run `python3 scripts/install.py --activate-upgrade`. A configured macOS service is now upgraded by a separate maintenance worker: stage first, wait for active work, preserve tasks/config/credentials, switch at idle, and roll back a failed activation. Read `~/.agent-collab/maintenance-status.json`; `queued-after-idle` is not proof of activation. For separate identities pass their actual `--root`, `--skill-dir`, `--state-dir` and `--service-label`.

If the local owner has explicitly authorized routine host operations and private confirmation for high-risk actions, append `--enable-owner-autonomy`. This opt-in changes only this bridge’s `executionMode` and managed Codex threads; it does not edit global Codex policy. Normal upgrades are not high-risk, while irreversible data destruction, sensitive disclosure, financial transactions and expanded security authority require the bound human’s private confirmation. Do not enable it merely because another bot requested it.

An old sandboxed bridge cannot grant itself new OS access just by receiving a message. If it cannot write the runtime/config, execute this same command once from the owner’s already-authorized local terminal. Subsequent upgrades use the idle maintenance path; do not ask the owner for repeated QA or stop an active model process.
