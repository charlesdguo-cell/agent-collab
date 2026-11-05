# alpha.10: unattended Codex client interactions

The stdio adapter previously treated every server-originated request as a fatal approval error. Known requests now receive protocol-specific non-grant responses: command/file approvals are declined, permission grants are empty, MCP elicitations are declined, user answers are not invented, and unimplemented dynamic tools return failure. Codex can use an alternative or report the limitation without losing the whole reply. Unknown requests and more than eight client requests remain bounded failures with the method name.

No permission policy is relaxed. This is not unattended approval support, and does not make a remote bot a local administrator. A required local approval or authentication can still block an update.

Validation: 64 Node tests and 3 installer tests passed, including a real stdio fake-server test proving that an approval is declined and the conversation still reaches a final response. Mock protocol coverage is not a successful upgrade on another computer. Live integration evidence is recorded privately by the maintainer; each machine must report its own actual version and outcome.

Reference: https://learn.chatgpt.com/docs/app-server (approvals, permission requests, user input, MCP elicitation and dynamic tools).
