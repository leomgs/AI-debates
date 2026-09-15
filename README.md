# AI Trend Debates — Backend

Backend for an automated pipeline that turns a trending topic into a short, fact-checked debate video between AI agents.

## What this is

Given a topic, the system researches it with real web sources, has two AI "debater" personas argue opposing views across structured rounds (opening, rebuttal, cross-examination), fact-checks every factual claim against the collected evidence before it's allowed into the debate, has a third AI act as judge, and synthesizes the final script into spoken audio. A human curator reviews and approves the result before it's handed off for video rendering.

The project is built around three constraints that shape most of the architecture:

- **Verifiability** — every factual claim in a debate must trace back to a source in an evidence base gathered before the debate starts. Claims that fail fact-checking go through an amendment loop with the agent instead of being silently allowed through.
- **Cost control** — every episode runs under a hard budget (LLM calls, search queries, TTS segments). Hitting a limit freezes the pipeline into a recoverable review state instead of failing silently or spending without bound.
- **Human-in-the-loop** — the pipeline is designed to pause and hand control to a human curator whenever something needs judgment: insufficient evidence, budget exceeded, a claim that keeps failing review, or the final episode before it ships. Nothing renders without explicit approval.

`Episode.status` is the single source of truth for where a given run is in this lifecycle — see `features.md` for the full state machine.

## Stack

- **NestJS 11** — API framework and module/dependency-injection backbone for the orchestration pipeline.
- **Prisma 7** — persistence (SQLite locally).
- **Vercel AI SDK** — multi-provider LLM abstraction with Zod-validated structured output; supports Google, OpenAI, Anthropic, xAI, and OpenRouter (free-tier models) as interchangeable `ModelProvider`s.
- **Zod 4** — contracts for agent I/O and HTTP DTOs.
- **Cockatiel** — retry / circuit-breaker around every external integration.
- **Tavily** — web search provider for the research stage.
- **echogarden + Piper** — local, free text-to-speech (Google TTS and OpenRouter audio providers are supported by the same abstraction, pluggable via `TTS_PROVIDER`).

See `architecture.md` for the full module map, dependency rules, and the orchestration algorithm.

## Getting started

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed          # loads the 4 debater agents + judge
```

Copy `.env.example` to `.env` and set `GOOGLE_API_KEY` and `TAVILY_API_KEY` (both free tier, no card required) — the app won't start without them. Full variable reference, where to get each key, and rate-limit details are in `setup.md`.

```bash
npm run start:dev   # dev server with watch
npm run test        # unit tests
npm run test:e2e    # end-to-end tests
npx tsc --noEmit    # type-check
```

Tests don't need any real API key — they run against mocks/dummies.

## Project documentation

This repo is documentation-heavy on purpose: the pipeline has non-obvious state machine and recovery behavior that's easier to get wrong than to write down once.

| Doc | Contents |
|---|---|
| `features.md` | Product spec: objectives, acceptance criteria, and the full `Episode` state machine per feature |
| `architecture.md` | Module map, dependency direction, orchestration algorithm, resilience patterns |
| `api-contract.md` | HTTP surface: endpoints, SSE events, error format, valid state transitions |
| `setup.md` | Full local setup checklist, env vars, and manual validation scripts |
| `coding-rules.md` | Conventions to follow when implementing a piece of the pipeline |
| `decision-log.md` | Why non-obvious decisions were made — what was considered, what was ruled out, what evidence settled it |
| `roadmap.md` / `tasks.md` | Delivery priority and module-by-module implementation status |

## License

UNLICENSED — private project, not published for reuse.
