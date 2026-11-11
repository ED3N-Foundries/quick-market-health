import { describe, expect, test } from "bun:test"
import { loadHealthEnv } from "./env"
import { renderPage } from "./page"

describe("renderPage", () => {
  test("embedded script parses as valid JavaScript", () => {
    const html = renderPage(loadHealthEnv({}))
    const m = html.match(/<script>([\s\S]*)<\/script>/)
    expect(m).not.toBeNull()
    // Parses (but does not execute) the page script: a stray newline inside a
    // JS string literal in the template would throw here, as it once did.
    expect(() => new Function(m![1]!)).not.toThrow()
  })

  test("contains the expected card anchors", () => {
    const html = renderPage(loadHealthEnv({}))
    for (const id of ["pill", "sub", "funding", "lifecycle", "hangs", "hangmeta", "diskline", "containers", "logs", "checks", "speeds", "bars", "tip", "raw", "copyjson"]) {
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).not.toContain('id="boot"')
    expect(html).not.toContain('id="routetails"')
    expect(html).not.toContain('id="querytails"')
    expect(html).toContain("<h2>where to fund</h2>")
    expect(html).toContain("<h2>hangs</h2>")
    expect(html).toContain("<h2>external probe speeds</h2>")
    expect(html).not.toContain("superseded")
  })

  test("layout cannot cause page-level horizontal scroll", () => {
    const html = renderPage(loadHealthEnv({}))
    // Belt-and-braces: body clips any stray overflow.
    expect(html).toContain("overflow-x:hidden")
    // Grid cards must shrink instead of forcing the page wide.
    expect(html).toContain("grid-template-columns:minmax(0,1fr)")
    // History bars must shrink/clip inside the card, never push it wide.
    expect(html).toContain(".bars { display:flex; gap:2px;")
    expect(html).toContain("overflow:hidden; max-width:100%")
    // Long log lines wrap instead of stretching the card.
    expect(html).toContain("white-space:pre-wrap")
    // Wide tables keep readable columns and scroll inside their card.
    expect(html).toContain("table.wide { min-width:680px; }")
    expect(html).toContain('<table class="wide">')
  })
})
