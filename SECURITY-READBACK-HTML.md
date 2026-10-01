# Saved-session HTML boundary fix

Date: 2026-10-01
Status: source fix prepared for pull request; beta artifact not repackaged

## Finding and scope

CodeQL `js/bad-tag-filter` flagged the script-boundary regular expression in
`extension/host/session-readback.js`. A browser-recognized closing tag such as
`</script\t\n bar>` was not recognized by that expression. Reproduction showed
both a missed valid loader and acceptance of a loader-looking decoy outside a
script. This establishes a readback evidence-boundary defect, not demonstrated
JavaScript execution or XSS.

The suggested broader closing-tag regex fixes that particular example, but does
not account for script-looking text in comments, attributes, inert templates,
or raw-text elements, or all browser-recognized closing forms.

## Change

- Use bundled parse5 8.0.1 to locate HTML-namespace script elements and their
  source offsets. Exclude inert template content and foreign-namespace scripts.
- Slice the original response text using those offsets; preserve literal NUL,
  CRLF, escaping, and exact interaction text. Reject unclosed scripts.
- Retain the existing bounded loader-data reader, identity checks, ambiguity
  rejection, response cap, and rule that partial history is not complete history.
- Share only the message identifier through `session-readback-protocol.js`.
  The sidebar no longer imports the worker implementation or HTML parser.
- Bundle the parser locally, with licenses and a locked reproducible build.
  No runtime download, host-script execution, new permissions, or additional
  web-accessible resources. Ordinary unpacked installs require no build step.

## Changed files for this patch

- `.gitignore` (ignore node_modules)
- `.gitattributes` (preserve reproducible vendor LF bytes across platforms)
- `package.json`, `package-lock.json` (locked vendor build tools)
- `scripts/vendor-html-parser.mjs`
- `extension/vendor/parse5.js`, `extension/vendor/THIRD_PARTY.txt`
- `extension/host/session-readback.js`
- `extension/host/session-readback-protocol.js`
- `extension/ui/panel.js` (only the SESSION_READBACK import for this patch)
- `test/session-readback.test.js`
- this report

The original checkout contained unrelated changes, including extensive panel
changes. This patch was transferred to an isolated checkout based on public
`main` at `9b6e115`, preserving those unrelated changes in the original checkout.

## Verification actually run

- New boundary tests first reproduced failures against the regex implementation.
- `node --test test/session-readback.test.js`: **51/51 passed**.
- `node --test "test/*.test.js"`: **732/732 passed**, no skips or cancellations.
- `node scripts/vendor-html-parser.mjs --check`: bundle and license output match
  the installed locked dependencies.
- Tests and the vendor check were repeated successfully in the isolated checkout.
- `git -c core.whitespace=cr-at-eol diff --check`: no whitespace errors. Existing
  source line endings were preserved, including the panel's mixed line endings.

Coverage includes malformed closing tags, comments/attributes, raw-text and
inert/foreign elements, exact original text, a >1 MiB synthetic session, the real
background entry with browser stubs, and sidebar/worker dependency separation.

CodeQL was not rerun locally (CLI unavailable); the repository's existing CodeQL
default setup was confirmed active before opening the PR. No live Chrome regression was
run for this patch. Release hashes, version, and packaged artifact have not been
updated; prior artifact approvals do not cover this source change.

## Reproduce vendor build

With Node.js 18+ and npm:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run check:vendor
npm test
```

To deliberately regenerate checked-in vendor files, use `npm run vendor:html`.
Next release gates: scoped review, GitHub CodeQL rerun, live readback/sidebar
smoke, then normal packaging and fresh artifact hashes.
