# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/aris99i/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/aris99i/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's csv-reader 1.0.0: it answers exactly as the reference does on every case (same {columns, rows, errors}, same broken-row policy) and reads the practice set about 3.5x faster than the reference on this machine. The reader jumps instead of reading one character at a time: an unquoted field is one regex match plus one slice, a quoted field jumps quote to quote with indexOf, and no result object is built per field.

## Files

- `solve.js` — the fast reader; `run(input)` returns csv-reader 1.0.0's answer for one case's input.
- `main.ts` — the program the harness runs; reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

Reads cases from `$MAKEFUN_INPUT_DIR/cases.json` (default `/input`) and writes answers to `$MAKEFUN_OUTPUT_DIR/answers.json` (default `/output`).

## Bounty

Built for the make.fun bounty [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

---

<sub>Entered on [make.fun](https://make.fun/?ref=pps563g6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
