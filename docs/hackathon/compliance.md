# Compliance

Snapshot fetched 2026-11-10T13:06:52Z. An `open` row is unfinished.

| Rule | Quoted text | What this repo does | Proof | Status |
| --- | --- | --- | --- | --- |
| Q-000 | "NEAR AI credits?" | This repo does not use a NEAR AI API key. | `src/model.ts` default URL is local | n/a |
| Q-001 | "Code before 2026-11-01? Yes, from the announcement on 2026-10-19" | The build log starts the counted work at 2026-10-19. Locals `7c38f56` is 2026-10-12 and is marked baseline. | README Build log | met |
| Q-002 | "Existing product on another chain? Allowed." | What is not NEAR names the Solana payment, `mppx`, the Base destination, and that the guard modules do not call a chain. | README What is not NEAR | met |
| Q-003 | "Dedicated branch, or tags pre-hackathon and hackathon-submission, plus a README section linking the diff." | Tag `pre-hackathon` exists. The diff link is `pre-hackathon...main`. `hackathon-submission` is not tagged. | README Hackathon diff | open |
| Q-004 | "New feature in the window: yes, if separated per Q-003." | The NEAR commits are 2026-11-10, after the tag `14b88e4`. | `git log` | met |
| Q-005 | "List in README; own old libs count as baseline." | Libraries and Code written with AI. | README | met |
| Q-006 | "1Click JWT? Not required. Without it, 0.2% fee." | `bursar merchant --mpp` passes `ONE_CLICK_JWT` only when it is set. When it is unset, the process writes that the 0.2% unauthenticated fee applies. | `src/merchant.ts`, `test/mpp.test.ts` | met |
| Q-007 | "Testnet for Intents? None exists or is planned." | Quotes are captured mainnet 1Click responses. No Intents testnet is called. | `test/fixtures/quote-live.json` | met |
| Q-008 | "Testnet NEAR is free" | No faucet is used by `npm test`. | `package.json` script `test` | n/a |
| Q-009 | "Public RPC free" | The check reads `https://rpc.mainnet.near.org`. | `src/decide.ts` | met |
| Q-010 | "Testnet-only projects eligible?" | This project reads mainnet. | README Links | n/a |
| Q-011 | "Own contract on NEAR that fits the track is enough." | `contract/` is the blocklist contract. | `contract/src/lib.rs` | met |
| Q-012 | "Hosted demo is a plus; keep it up to 2026-11-18, ideally 2026-11-25." | The page exists in `web/` and is not published. No X post. | README Links | open |
| Q-013 | "Team keeps all rights" | No rights assignment is in the repo. | LICENSE is MIT | n/a |
| Q-014 | "add a LICENSE file." | MIT licence file. | `LICENSE` | met |
| Q-015 | "One person, several projects?" | There is no second NEAR Hackathon entry. The Solana payment in Links is one transaction, not another submission. | README Links | n/a |
| Q-016 | "Single payment, no vesting, within 30 days of results." | Organizer schedule. Nothing to build. | snapshot | n/a |
| Q-017 | "reproducibility check, feature verification" | Do this, see that has exact output fences. `npm run check:readme` re-runs them. | `scripts/check-readme.mjs` | met |
| field requestId | "UUID, generated once per submission" | Not generated. | — | open |
| field projectName | "2-80 characters" | Not submitted. | — | open |
| field leadName | "2-80 characters" | Not submitted. | — | open |
| field email | "valid email, max 160 characters" | Not submitted. | — | open |
| field size | "one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`" | Not submitted. | — | open |
| field tracks | "one or more of `defi`, `thesis`," | README names security, agents, realworld, privacy. Not submitted. | README Tracks | open |
| field nearAddress | "2-64 characters, lowercase" | Not submitted. | — | open |
| field projectUrl | "http(s) URL of the public repository" | Not submitted. | — | open |
| field demoUrl | "http(s) URL of the public demo post" | Not submitted. | — | open |
| field idea | "20-2000 characters" | Not submitted. | — | open |
| field consent | "`true`, only after the human agreed to the contact notice." | The notice has not been read for a submission. | — | open |
| never submit | "Send the submission." | Not sent. | — | open |
| never X | "Post anything on X or another network on their behalf." | Not posted. | — | open |
| never public | "Make the repository public, push, or force-push." | Not done from this change. | — | open |
| never sign | "Sign transactions, spend tokens or deploy to mainnet." | Deploy, reporter funding, the report, `anchor`, and the 0.25 USDC payment were sent after a yes. | README Links, `docs/hackathon/evidence.json` | open |
| never secrets | "Commit secrets." | No key file is added here. | — | open |
| submit repo | "The repository is public, and the README has do X, see Y steps" | The steps are in the README. Public state is not changed here. | README Do this, see that | open |
| submit post | "Your demo post is live on X" | No post. | — | open |
| submit payout | "You have a mainnet NEAR account for the prize payout" | Not collected. | — | open |
| submit tracks | "You've selected every track your project fits" | Named in the README, not submitted. | README Tracks | open |
| submit secrets | "There are no keys or secrets anywhere in the repo history" | Not re-scanned in this change. | — | open |
| submit deadline | "You're submitting before Nov 14, 2026, 23:59 UTC" | Not submitted. Today in the snapshot fetch is 2026-11-10. | snapshot header | open |
