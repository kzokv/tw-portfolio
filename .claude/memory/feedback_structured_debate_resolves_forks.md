---
name: structured debate resolves architectural forks
description: The /debate skill resolves decisions with >1 viable option and downstream lock-in — saved an entire iteration on thin vs rich endpoint
type: feedback
---

Use structured debate (`/debate`) for architectural decisions with >1 viable option and downstream lock-in.

The thin vs rich endpoint debate (Option 1 vs Option 3 for API AAA `BaseEndpoint`) reached unanimous 3-of-3 consensus. All three domain-expert agents independently converged on the same structural argument: `BaseEndpoint` should mirror `BasePage` as vocabulary (HTTP bindings), not behavior (pre-parsed typed returns).

**Why:** Without the debate, the implementation would have started with Option 3 (richer service client), which would have created type lies for the 47% of tests that assert on non-2xx responses. Discovering this mid-implementation would have required a full rewrite of the endpoint layer.

**How to apply:** When a design has >1 viable option with different downstream consequences, run `/debate` before implementation. The frozen debate record at `docs/004-notes/{area}/debate-{datetime}-{slug}.md` becomes a durable decision reference. Worth the 10-minute investment for any decision that would take >2 hours to reverse.
