# Requirements traceability

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Show all live agent sessions attention-first | `Model.js`, `Panel.qml` | model, mutation, and Buzz E2E tests |
| Go visually urgent when work needs the user | `pillText`, bar active state, blocked rows | model tests and full-frame preview |
| Keep private local state safe under hostile paths | `bin/crew-chief-spool` | spool-security integration and race tests |
| Never perform unbounded recurring work | helper census/read/retention caps and model caps | contract, model-bound, and gate C42 tests |
| Operate without network, accounts, or telemetry | local reporters/adapters only | security contract and gate C38 |
| Work by mouse and keyboard | `PanelKeyCatcher`, row/clear controls | accessibility contract and Buzz render |
| Tell the marketplace a complete, specific story | exact descriptions, banner, preview receipts | contract test and gate C43 |

