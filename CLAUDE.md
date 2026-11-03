# Habblaud — for AI agents

Habblaud is a pixel-art virtual office that shows, in real time, what Claude Code and Codex agents are doing: a Node
server with no runtime dependencies (`server/`), a browser page (`client/`) and shared code (`shared/`). The code,
comments and docs are in English. Every visible text goes through `tr('English text')`; the only translation is
Vietnamese, in `shared/locales/vi.ts` (`npm run i18n:check`). Every visible change goes under "Unreleased" in
`CHANGELOG.md`. The rest is in `CONTRIBUTING.md`.
