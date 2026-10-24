// axe-core, for auditing Morse's own interface (tests and `npm run ui` only;
// it is never part of the extension or the runtime). The copy in
// demo/vendor/ is axe-core 4.13.0 from npm, unchanged (MPL-2.0, see
// demo/vendor/axe-LICENSE.txt); scripts/check.js makes sure the built
// extension never includes it.
//
//   const found = await axeCheck(page)           // Morse's overlay (its shadow root)
//   const found = await axeCheck(page, { page: true })  // a whole page (welcome, popup…)
//
// Returns [{ id, impact, help, targets }], one per broken rule, already
// filtered to what applies to an overlay on someone else's page.
import { readFileSync } from "node:fs";

export const AXE_VERSION = "4.13.0";
const AXE = readFileSync(new URL(`./vendor/axe-${AXE_VERSION}.min.js`, import.meta.url), "utf8");

// WCAG 2.2 A and AA, plus axe's best practices.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
// Rules about a whole document, which the overlay isn't: it sits on top of
// someone else's page, so landmarks and headings are the page's business.
// heading-order too: the overlay can sit on any page, after whatever heading
// level that page ends on; Morse's own sheets and cards keep theirs in order.
const OVERLAY_OFF = ["region", "landmark-one-main", "page-has-heading-one", "bypass", "landmark-complementary-is-top-level", "landmark-unique", "heading-order"];

// page: a Playwright Page or Frame. The overlay's shadow root is open only in
// debug (catalog-host.js and the tests set morse:debug under automation).
export async function axeCheck(page, { page: whole = false, disable = [] } = {}) {
  // Evaluated as a script by the debugger, so a page's own CSP can't block it.
  await page.evaluate(`globalThis.axe || (() => { ${AXE}\n })()`);
  const off = Object.fromEntries([...(whole ? [] : OVERLAY_OFF), ...disable].map(id => [id, { enabled: false }]));
  return page.evaluate(async ({ whole, off, tags }) => {
    const host = document.querySelector(":root > [data-morse-ui]");
    if (!whole && !host) return [{ id: "no-overlay", impact: "critical", help: "Morse's overlay isn't on the page", targets: [] }];
    // One run at a time per page (axe refuses to overlap itself).
    while (globalThis.__axeBusy) await globalThis.__axeBusy;
    let done;
    globalThis.__axeBusy = new Promise(r => (done = r));
    try {
      const r = await globalThis.axe.run(whole ? document : { include: [host] }, {
        runOnly: { type: "tag", values: tags }, rules: off, resultTypes: ["violations"],
      });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map(n => [].concat(n.target).flat().join(" ⟩ ")).slice(0, 6) }));
    } finally { globalThis.__axeBusy = null; done(); }
  }, { whole, off, tags: TAGS });
}

// One line per broken rule, for logs and the catalog's verdicts.
export const axeLines = found => found.map(v => `axe ${v.id} (${v.impact}): ${v.help} · ${v.targets.slice(0, 3).join(", ")}${v.targets.length > 3 ? ", …" : ""}`);
