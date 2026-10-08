# Contributing

Thanks for looking. This is a personal project, but issues and pull requests are welcome.

## Setup

You need Node 22 or newer and pnpm (`corepack enable` sets pnpm up).

```
pnpm install
pnpm demo           # the app on fake data, at http://127.0.0.1:4179
pnpm dev:server     # or the API alone, on http://127.0.0.1:4178
pnpm dev:web        # and the UI with hot reload, on http://127.0.0.1:5173
```

`pnpm dev:server` uses your real data directory (see the README). Use `pnpm demo`, or set
`TJ_DATA_DIR` to a scratch directory, while you try changes out.

## Before a pull request

```
pnpm format         # Biome: formats and fixes what it can
pnpm lint
pnpm typecheck
pnpm test
```

CI runs lint, typecheck and the tests on Ubuntu and Windows, so keep paths, line endings
and timings portable. Use `path.join`, and avoid tests that write hundreds of megabytes or
lean on wall-clock time. A test that wrote 120 MB to the temp directory once slowed
Windows CI twentyfold.

## How changes are made

- **Specs and plans** live in [`docs/superpowers/`](docs/superpowers/). A feature starts
  as a design spec (`specs/`), becomes a task-by-task plan (`plans/`), and is built
  test-first. Each spec records its decisions and the deferred minors from its final review.
- **Tests come first.** Write the test, watch it fail, then make it pass. Domain logic lives
  in `packages/core` as pure functions, which keeps most tests fast and free of mocks.
- **One feature per branch and pull request**, merged into `main` once CI passes.

## Data

Real trading data never enters the repository: fixtures are fake or sanitised, and
screenshots in the docs come from `pnpm demo`. The app keeps your journal, backups and
API tokens in a data directory outside the repository.
