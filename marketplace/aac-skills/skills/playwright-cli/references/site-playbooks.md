# Per-Host Playbooks

Before improvising a fresh exploration of a site, check for a saved playbook first.

```
domain-skills/<host>/playbook.md
```

`<host>` is the bare domain the task is automating (`github.com`, `app.example.com`). If a
playbook exists for that host, read it and follow its known selectors, login flow and gotchas
instead of rediscovering them by trial and error.

If none exists and the task is one you expect to repeat — a recurring login flow, a multi-step
checkout, a dashboard with unstable auto-generated test ids — write one after finishing, so the
next run starts from the playbook instead of from scratch. Skip it for a one-off page you will
not revisit.

A playbook records what the live page actually needs, not the CLI's own commands: selectors that
survive a redeploy (role/text locators over generated ids), the login or consent steps in order,
and known traps (a dialog that appears once per session, a field that only accepts `fill` after a
click elsewhere). Keep it short and update it in place when the site changes underneath it.
