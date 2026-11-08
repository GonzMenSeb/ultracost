# CLAUDE.md

Guidance for working on the ultraguard plugin itself.

**Tests:** `npm test` (runs `node --test tests/*.test.js`). CI runs it on Node 18, the hook runtime, so use no Node 20+ APIs. Plain ESM JavaScript, no dependencies, no build step; `vendor/acorn.mjs` is acorn 8.19.0 copied from its npm `dist/acorn.mjs`.

**Hard rule:** after `npm test` passes, live-verify every change by loading the plugin from this local working copy into Claude Code, turning on ultracode (`/effort ultracode`), and confirming the behavior with prompts before claiming it works. Load it with either:
- `claude plugin marketplace add /home/sebastian/versioned-code/ultraguard` then `claude plugin install ultraguard@ultraguard`
- `claude --plugin-dir /home/sebastian/versioned-code/ultraguard`

Tests in isolation are not enough.

**Versioning:** bump the **patch** version only (`0.4.x`) unless the user explicitly asks otherwise. Keep `package.json`, `.claude-plugin/plugin.json` and the `ultraguard` entry in `.claude-plugin/marketplace.json` in sync (enforced by `tests/version-sync.test.js`).

**Policy:** `policy/default.json` is the only policy. Changing it means editing it here and bumping the patch version.
