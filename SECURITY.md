# Security

## Reporting a vulnerability

Email **hello@get-handoff.com**. Please do not open a public issue for a security problem —
a report in the tracker is visible to everyone before there is a fix.

Useful to include: what an attacker can do, the steps to reproduce it, and the version of
the package (`handoff --help` does not print it; `npm ls get-handoff` does).

You'll get an acknowledgement as soon as the message is read — this is a small project, so
that may take a few days rather than a few hours. Please give a fix a reasonable window
before disclosing publicly.

## Scope

This file covers the `get-handoff` CLI. Problems with the Handoff browser extension, the
hosted service or a published walkthrough link go to the same address.

## Handling your key

The CLI never writes your agent key to disk: it is read from `--key` or `HANDOFF_KEY` on
every invocation. Treat it as an API-key-class secret — anyone holding it can read and
create walkthroughs for your account. Take care in shared shell history and CI logs.
