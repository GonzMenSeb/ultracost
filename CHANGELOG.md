# Changelog

## 0.4.6 - tierguard

- Rewrote the fork of ultracost as `tierguard`, a per-agent delegation gate for Workflow launches.
- New static gate: parses the script with vendored acorn and checks every `agent()` for a class label, a literal model and effort, and a `blocked_on` schema on Sonnet and Haiku stages.
- Allowed (model, effort) pairs live in `policy/default.json`. The session model caps the allowed models.
- Launches by name, mixed sources and `workflow()` children are denied. Runtime env overrides of model and effort are denied.
- SessionStart prints the policy guidance and the rendered pairs table.
- Fails closed on any internal error or timeout.
- Removed the old ultracost engine, commands, docs and assets.
- Probe results on Claude Code 2.1.319: `code:` and `grunt:` allow `haiku` at `xhigh`; the session cap reads the main thread's `api-request` row written after the last main-thread assistant row (the request in flight), falling back to that assistant row and any later `/model` command; the README lists which effort knobs override, clamp or do not touch an explicit `agent()` effort.
