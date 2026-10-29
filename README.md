# Learnins

Learnins is a local-first learning workspace built on [LearnHarness](https://github.com/amosblomqvist/learnharness). It keeps its measure → plan → teach → practice loop and knowledge graph, and adds a study library, flashcards, exam planning and coding practice.

## Start on Windows

Double-click **Start-Learnins.cmd**, or open a terminal in this folder and run:

```powershell
npm run desktop:dev
```

The launcher starts a local development server, waits for it to become ready, and opens the Electron app. Keep its terminal open while using the app; closing the app stops the server. Node.js 24 and the project's dependencies are required. A fresh `npm ci` may download a large dependency set; check its size and available storage before reinstalling. The source development server uses this repository's `data/` and `auth.json`; the Electron window also has a separate `Learnins-dev` directory for its own window data.

For a browser-only development session, run `npm run dev` and open the local address printed in the terminal. It uses the same repository `data/` and `auth.json` as the desktop development launcher. The desktop app also provides native subscription connection and window features.

## Start learning

A short tutorial opens on the first launch. You can skip it or open it again with **Tutorial** on Home.

1. Select **Connect a provider** on Home. Choose a supported subscription connection or an API-key provider, then pick the strong, cheap and vision model slots.
2. Start a teaching or practice session with a topic. The existing adaptive lesson and knowledge graph carry your learning forward.
3. Use **Materials** to add files, **Flashcards** to review, **Planner** to schedule revision, and **Coding** to run and discuss code with the tutor.

The provider picker stores API keys after a format check; a successful save is not a live verification of the provider account. **Local Codex** uses an already installed Codex CLI signed in with a ChatGPT account and can use Learnins' lesson tools. Its own shell, browser and MCP tools are disabled. Connecting is optional, and background use can be switched off. Model usage is subject to the provider's terms and limits. General ACP connections to other agents are not yet included.

## Study tools

- **Materials:** PDF, DOCX, PPTX, images, text, Markdown, CSV/TSV, code and exported Teams VTT/SRT transcripts. Originals and extracted text are kept locally. Text-only extraction cannot interpret diagrams; the tutor can use its existing PDF or image tools on the saved original. Live Microsoft Teams account sync is not included.
- **Flashcards:** create decks and cards, paste tab-separated word pairs, or add propositions from the knowledge graph. Review ratings schedule the next encounter. Cards and decks can be edited or removed.
- **Planner:** add exam dates, topics, available days, a daily time window and study-block length. Overlapping Learnins blocks move later within that window when possible; existing Google Calendar events are not checked. Connect Google Calendar to add a whole plan to the primary calendar, export an `.ics` file, or open individual events in Google Calendar for review. Direct connection uses an installed Google Workspace CLI and its OAuth client, with a separate Learnins sign-in; the existing CLI profile is not changed. Sign in through the planner and grant access to events on calendars you own. Additions are one-time copies, not continuous sync; changing or deleting a Learnins block does not change an event already added to Google Calendar.
- **Coding:** run JavaScript, TypeScript and Python in an isolated browser worker, add assertions, and send the code and output to a teaching draft. Open the same workspace from a lesson to add the result to your reply; if a question is waiting, copy it into your answer instead. Drafts are shared across sessions. Python's bundled Pyodide runtime is approximately 14 MB. External network and host-file access are disabled in the runner; the Python runtime is loaded from the local app.
- **Research:** automatic free web search uses DuckDuckGo, with Wikipedia as a narrower fallback when web search is unavailable. Optional Tavily and Brave keys remain supported.

## Data and privacy

When running from source, including through `Start-Learnins.cmd`, study data and imported originals live in `data/`, and provider keys and subscription credentials live beside `auth.json`; these are ignored by Git. The desktop shell also uses a separate `Learnins-dev` directory for its own window data. A packaged desktop app keeps its learning data and credentials in its per-user application data directory. Back up the relevant data and credential files if they matter to you.

Provider keys and subscription credentials are stored locally in plaintext files by the inherited LearnHarness connection system. The Google Workspace CLI keeps the separate calendar sign-in under `data/google-calendar` (or the packaged app's data directory); its file-based encryption key is also stored locally. Local Codex remains signed in through its own CLI. Operating-system file permissions matter, especially on shared machines. Model requests, web searches and calendar actions contact the selected external services. General ACP integration and live Microsoft Teams sync are not implemented.

Automatic updates are disabled until a Learnins-specific update feed is explicitly configured; the fork will not silently install an upstream LearnHarness release.

## Development

```powershell
npm run typecheck
npm run lint
npm test
```

The test runner works on Windows, macOS and Linux. Tests that require POSIX file modes are skipped on Windows, where ACLs determine access instead.

Learnins is a fork of LearnHarness by Amos Blomqvist and remains available under the [AGPL-3.0 license](LICENSE).
