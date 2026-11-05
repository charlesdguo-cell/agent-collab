# Install Agent Collab with your local Agent

You are the installing Agent on the user's own computer. Complete the workflow, not just a download. No remote access to a maintainer's machine is required. Current supported acceptance target: macOS + Codex, Node.js 24+ and Python 3.9+.

1. Read the user's project instructions. Confirm the actual computer and desired local project directory. Check existing `~/.local/share/agent-collab`, `~/.agents/skills/agent-collab`, `~/.agent-collab` and launchd service without printing secrets. Preserve existing installs; do not launch a duplicate bot or overwrite a configuration.
2. Clone the PUBLIC repository without credentials into a new local checkout:
   `git clone --branch v0.1.0-alpha.8 --depth 1 https://github.com/charlesdguo-cell/agent-collab.git`
   Read its source before executing the installer. Record `git rev-parse HEAD`. Do not copy code from an unrelated local project or run a moving main branch instead of this tagged release.
3. Check `node --version`, `npm --version`, `python3 --version`, `codex --version`, and `codex login status`. Reuse valid existing Codex login. If Node 24+ is missing, install an official Node distribution for the actual OS/architecture and verify its published SHA-256 first. Never disable TLS or system security. If tooling cannot be installed under the Agent's permissions, report the precise missing prerequisite.
4. In the checkout run `python3 scripts/install.py`. It installs a versioned runtime and a stable Skill link, but DOES NOT configure credentials, start the bot, or claim acceptance. Existing differing installations are preserved rather than overwritten.
5. Read the installed `~/.agents/skills/agent-collab/SKILL.md` and continue its setup and automatic self-check steps in this same session. If a fresh Agent session is needed for Skill discovery, it can still read the file directly now.

The installation needs the user's dedicated Feishu self-built application bot, group, and local project. Use an existing dedicated bot if supplied; do not make a second bot or share an active event listener. Guide necessary console permissions/login locally. Credentials belong only in the loopback setup page, never in chat, shell arguments, or shared logs. If human action is indispensable, ask for that one action and resume from the saved phase, without repeating completed setup.

Report stages separately: runtime/Skill installed → identity/config verified → service running; live group behavior is release QA owned by maintainers, not an installer assignment. Public access is not evidence of any later stage. Record the exact blocker if not all stages pass.


## Continue without a maintainer

The installed management Skill links to `references/feishu-setup.md`, `references/troubleshooting.md` and `references/usage.md`. Read the relevant reference, diagnose on THIS computer, and complete the next stage. Do not send the user to the package author as a normal installation step. If the Agent cannot use a browser or send a human-identity message, guide that minimal user action locally; no maintainer intervention or remote access is required.

Both `agent-collab` (installation/management) and `team-consult` (ongoing collaboration) are installed under the chosen skill directory. Verify both links resolve and read both Skills now; new sessions discover them automatically where supported. Installing a Skill does not attach the currently running Codex session to the bridge: the usage guide describes explicit task handoff.

An existing older runtime without any background-service plist may be selected with `scripts/install.py --activate-upgrade` after inspecting the old receipt and confirming the user intended the upgrade. This changes only runtime/Skill selection. A configured background service is preserved and requires a separate, evidence-based upgrade; do not remove its plist or state merely to bypass this guard.
