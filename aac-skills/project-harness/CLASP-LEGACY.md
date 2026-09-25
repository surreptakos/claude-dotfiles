# Clasp repos (legacy)

Reference for step 13 of [`SKILL.md`](SKILL.md), for a repo the owner explicitly keeps on clasp
instead of the gas package. A self-deploying repo has nothing credential-shaped to wire and skips
this file.

- **Copy `templates/clasp-auth.js` to `tools/clasp-auth.js`.** Its value is that it checks the
  grant's **scopes**, not merely that the token refreshes.
- **It is AAC-hardcoded on purpose.** `CLIENT_ID` and `ACCOUNT` name the private OAuth client in
  `gpt-sheets-access-475817` and the account owning the bound scripts. A non-AAC repo needs both
  edited by hand — nothing can detect them, and a wrong guess yields a tool that confidently
  validates the wrong credential. Say so at handoff whenever you install it into a non-AAC project.
- **Wire `prepush` to `node tools/clasp-auth.js --quiet`** where there is a `package.json`.
  `~/.clasprc.json` is shared by every clasp project on the machine, so a bare `clasp login` yields a
  credential that pushes fine here while silently breaking Gmail and Drive work in another repo.
- In step 4, confirm session-check's Apps Script section reports the credential rather than
  `no tools/clasp-auth.js`.
