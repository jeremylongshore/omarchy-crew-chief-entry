# Testing

Crew Chief uses a seven-layer fail-closed test model.

| Layer | Evidence |
| --- | --- |
| Git hook | `.githooks/pre-push` runs the complete offline suite and vendored gates |
| Static | ShellCheck, Perl syntax, manifest/JavaScript contracts, and C28-C43 gates |
| Unit | Model parsing, normalization, bounds, ordering, labels, ages, and keyboard/accessibility contracts |
| Integration | Real hooks, reporters, installer, Herdr adapter, and descriptor-bound spool helper against temporary homes |
| System | `rig-verify.sh` runs the upstream validator and `qmllint` inside Buzz production |
| E2E | `e2e/buzz.sh` installs the runtime in an isolated real shell, seeds records through unchanged production reporters/hooks, opens the panel by IPC, and captures the full frame |
| Acceptance | C43 requires two exact 500-character descriptions, a themed banner, a hash-bound render receipt, and explicit approval of the exact preview SHA |

The default suite enforces 95% statements, lines, and functions and 90% branches.
Mutation testing blocks below 90%. The race lane repeats the complete offline
suite three times with concurrent execution. Hostile-path integration tests
cover planted links, FIFO input, oversized records, live parent-directory swaps,
concurrent writers, bounded census work, and complete JSON publication.

The Buzz fixture is rig-only. Production contains no fixture mode and executes
the same spool helper, hook/reporter boundaries, model, bar, and panel used by a
real Omarchy session.
