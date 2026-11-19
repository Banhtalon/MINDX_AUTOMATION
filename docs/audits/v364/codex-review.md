## CRITICAL

None.

## HIGH

- **Student names can reach Gemini in link URLs.** The prompt anonymizes each link’s name but appends `l.url` unchanged. A temp probe confirmed a student’s hyphenated full name remained in the prompt. [src/lib/gemini/spck-demo-sheet-scorer.ts:696](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/spck-demo-sheet-scorer.ts:696>)

- **PII can reach logs.** The fallback log includes `stu.studentId`, which can encode the student’s name, and the retry log prints the raw exception message. Probes confirmed both a transliterated student ID and a PII canary were logged. [src/lib/gemini/spck-demo-sheet-scorer.ts:928](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/spck-demo-sheet-scorer.ts:928>) [src/lib/gemini/client.ts:136](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/client.ts:136>)

- **Stop Bot does not abort an in-flight Gemini call.** `callGeminiWithRetry` awaits the request without racing against the abort flag or checking it after the request resolves. A probe set `shouldAbort` during a pending call; the helper still returned the API result after 111 ms. [src/lib/gemini/client.ts:125](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/client.ts:125>)

## MEDIUM

- **Permanent API errors get a second call in the scorer.** The live scorer’s catch treats every non-transient error as eligible for the lower-temperature retry, though the repair retry should be limited to malformed JSON. A stubbed 401 produced two API calls. [src/lib/gemini/spck-demo-sheet-scorer.ts:817](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/spck-demo-sheet-scorer.ts:817>)

- **Several common network codes are not classified as transient.** Direct `ECONNREFUSED`, `ENOTFOUND`, and `EHOSTUNREACH` errors returned `false`, so they skip retry unless wrapped in a recognized message such as `fetch failed`. [src/lib/gemini/client.ts:67](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/client.ts:67>)

- **`maxRetries: Infinity` is accepted.** The loop is unbounded for this option unless an external abort occurs. The default is finite, but the helper does not enforce a finite limit. [src/lib/gemini/client.ts:116](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/client.ts:116>)

## LOW

- **Retry hints longer than the cap are shortened.** A Gemini hint requesting a wait longer than `maxDelayMs` is clamped to that cap, which can cause retries before the server’s indicated time. The independent CLI reviewer also reported this. [src/lib/gemini/client.ts:106](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/lib/gemini/client.ts:106>)

- **The all-fallback banner can misstate why scoring was skipped.** It displays “AI busy or no submission files” whenever no students were pre-scored and at least one was skipped. Skips also include parse errors and other AI errors. [src/components/final-project/useSpckWorkflow.ts:1865](<D:/MINDX DATA/FINAL_PROJECT/MINDX-AUTOMATION/src/components/final-project/useSpckWorkflow.ts:1865>)

## INFO

### Commands and results

- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` — exit 0.
- `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-sheet-resilience-v364.ts` — exit 0; V364-01 through V364-04B passed.
- `node .\node_modules\tsx\dist\cli.mjs scripts/test-native-demo-gsheet.ts` — exit 0; GS-01 through GS-05 passed.
- `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-ai-and-drive-reupload-v351.ts` — exit 0; T1–T5 passed.
- `node .\node_modules\tsx\dist\cli.mjs scripts/test-spck-reupload-v353.ts` — exit 0; R353-01 through R353-04 passed.
- `node .\node_modules\tsx\dist\cli.mjs "$env:TEMP\mindx-v364-adversarial-probe.mjs"` — exit 0; exposed the network-code, unbounded retry, log, URL anonymization, and 401 retry gaps above.
- `node .\node_modules\tsx\dist\cli.mjs "$env:TEMP\mindx-v364-inflight-abort-probe.mjs"` — exit 0; returned the result despite Stop Bot being set.
- Temp probe files and their temporary data were removed. The repository status matched its initial state; I made no repository changes.
- The requested Codex CLI model `gpt-6.1-sol` was unavailable for this account. A read-only review using the CLI’s default `gpt-6-luna` completed and flagged the retry-hint cap.

### Protected data hashes

All four hashes matched before and after the run:

| File | SHA-256 |
|---|---|
| `data/mindx_bot.db` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` |
| `data/mindx_bot.db-wal` | `61CAC43B350609F81495EFE7D3D2DFE5290B187CB7DB9119B7EE54362239404F` |
| `data/running_classes.json` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` |
| `data/config/lms_class_ids.json` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` |

`Get-FileHash` hit a sharing violation on the live database and WAL; Node’s SHA-256 read succeeded before and after.

**VERDICT: NO-GO**