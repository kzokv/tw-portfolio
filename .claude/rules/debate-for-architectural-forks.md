# Debate for Architectural Forks

Use structured debate (`/debate`) for architectural decisions with >1 viable option and downstream lock-in.

**When to use:** A design has >1 viable option with different downstream consequences, and the wrong choice would take >2 hours to reverse.

**Pattern:**
1. Run `/debate` with the specific question and options
2. Domain-expert agents argue independently → consensus or split recorded
3. Frozen debate record at `docs/004-notes/{area}/debate-{datetime}-{slug}.md` becomes a durable decision reference

**Why:** The thin vs rich endpoint debate (Phase 5e) reached unanimous 3-of-3 consensus. All three domain-expert agents independently converged on the same structural argument. Without the debate, the implementation would have started with the richer option, which would have created type lies for 47% of tests — requiring a full rewrite of the endpoint layer.

**How to apply:** Before starting implementation when you identify a design fork. Worth the 10-minute investment for any decision that would take >2 hours to reverse. Do not use for preference-level choices (naming, formatting) or choices with easy rollback.
