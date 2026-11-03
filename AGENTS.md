# Bang_ver — for AI agents

Bang_ver is a pixel-art virtual office for a team of AI agents, forked from Habblaud: a single office with a boss and
seats for workers (Antigravity `agy` and Claude Code accounts). It has no mods, no Habblaud World and no Codex. It is a Node
server with no runtime dependencies (`server/`), a browser page (`client/`) and shared code (`shared/`). The code,
comments and docs are in English. Every visible text goes through `tr('English text')`; the only translation is
Vietnamese, in `shared/locales/vi.ts` (`npm run i18n:check`). Every visible change goes under "Unreleased" in
`CHANGELOG.md`. The rest is in `CONTRIBUTING.md`.
