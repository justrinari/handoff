# Contributing

This is a small project maintained by one person alongside other work. Setting
expectations honestly up front: contributions are welcome, replies are not instant.

## Issues

Open one. A bug report is most useful with the plan file that reproduces it (or a reduced
version of it), the exact command you ran, the Node and Chrome versions, and what the CLI
printed. If a step failed, `--local <file>` writes the failure reason next to the frame —
that is usually the fastest thing to attach.

## Pull requests

- Small, focused fixes: send the PR straight away.
- Anything larger — a new plan action, a change to the output format, a new flag — please
  open an issue first and describe what you're after. It may already be decided against, or
  turn out to belong on the server side, and it's cheaper to find that out before you write
  the code.
- Keep the diff to one thing. Two unrelated changes in one PR take twice as long to review
  and land together or not at all.

## Running the tests

```sh
npm install
npm test          # vitest
```

The suite is fast and needs no browser: everything that would launch Chrome is either
tested through the flag wiring or left to `npm run smoke:capture`.

One guard is worth knowing about before it surprises you: this repository is English-only,
and `src/no-cyrillic.test.js` fails on any Cyrillic character in a source, `.md`, `.json`,
`.yml` or `.yaml` file anywhere in the tree — plus the extensionless files at the root,
which is how `LICENSE` is covered. "Anywhere" means the whole repository, not just the CLI:
`skills/`, `docs/`, `examples/` and `.github/` are walked too, because a stranger reads
those as readily as the README. It reports the file and the line, so a red run tells you
where to look. (`node_modules` is excluded and must stay excluded.)

## Licence

The project is under [PolyForm Shield 1.0.0](LICENSE); contributions are accepted on those
terms.
