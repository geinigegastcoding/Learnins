<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Learnins

Understand the request and relevant code before changing it. Prefer the simplest solution that fits existing patterns and preserves the user's intent. Make routine implementation decisions yourself; ask a focused question when a consequential product decision is unclear or an action could irreversibly affect user data. Share a plan when it helps coordinate substantial work or the user asks for one; do not require plan approval for every change.

Consider the web and Electron desktop experiences when they are affected. Protect real user data, credentials, and running processes; use isolated data for experiments and stop only processes you started. Follow the user's download limits and other explicit instructions.

## Two apps on this device

Maintain two distinct Learnins apps: **Learnins** is the normal app, normally reflecting remote `main`; **Learnins Test** is for reviewing agent changes. Build or update the test app with changes first so the user can try them. Keep their installations and data separate, protecting the user's normal app data. When the user approves the changes for a pull request, prepare the PR and update the normal app with the approved changes at that point, even if the PR has not yet merged. After merge, the normal app should again reflect remote `main`. Do not assume this setup already exists; if it does not, explain what is needed and establish it without overwriting existing data.

Make Learnins Test discoverable and launchable as **Learnins Test** through Windows Start menu search.
On this device, the Start menu shortcut launches `%LOCALAPPDATA%\LearninsTest\Start-LearninsTest.ps1`. It lets the user select an existing Git worktree and runs that worktree's development app with test data and credentials under `%LOCALAPPDATA%\LearninsTest`; keep the launcher window open. Worktrees with the same lockfile can reuse the main checkout's installed dependencies; other worktrees need their own dependencies. Respect the download limit before installing them.

Verify changes at the appropriate scope. Use focused tests for behavior that can break, extending existing tests where practical. For visual changes, inspect the result in a real client when available. Run relevant checks using the scripts in `package.json`; report what was checked and any limitations. Avoid unnecessary broad checks and tests that merely repeat implementation details.

Do not create a pull request unless the user asks. Keep temporary notes and implementation plans out of commits. These instructions are defaults; the user's explicit preferences take precedence.
