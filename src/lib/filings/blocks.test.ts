import { describe, expect, it } from "vitest";
import { decodeFiling, htmlToBlocks, removePageFurniture, runningHeaderKey } from "@/lib/filings/blocks";

const blocks = (html: string) => htmlToBlocks(html).map((b) => b.text);

describe("htmlToBlocks", () => {
  it("makes one block per paragraph-like element", () => {
    expect(blocks("<body><p>First.</p><div>Second <b>bold</b> part.</div></body>")).toEqual([
      "First.",
      "Second bold part.",
    ]);
  });

  it("drops the hidden inline-XBRL header and display:none elements", () => {
    const html = `<body><div style="display:none"><ix:header><ix:hidden>secret</ix:hidden></ix:header></div>
      <p>Visible.</p><span style="DISPLAY: none">hidden fact</span><p>Also visible.</p></body>`;
    expect(blocks(html)).toEqual(["Visible.", "Also visible."]);
  });

  it("joins the cells of a table row into one line", () => {
    const html = "<table><tr><td>Item 1A.</td><td>Risk Factors</td></tr><tr><td>Item 7.</td><td>MD&amp;A</td></tr></table>";
    expect(blocks(html)).toEqual(["Item 1A. Risk Factors", "Item 7. MD&A"]);
  });

  it("marks rows of a data table as 'table'", () => {
    const html = `<p>Intro</p><table>
      <tr><td></td><td>2025</td><td>2024</td></tr>
      <tr><td>Net sales</td><td>$ 706,413</td><td>$ 674,538</td></tr>
      <tr><td>Change</td><td>4.7 %</td><td>(1.2)</td></tr></table><p>After</p>`;
    expect(htmlToBlocks(html).map((b) => [b.text, b.kind])).toEqual([
      ["Intro", "text"],
      ["2025 2024", "table"],
      ["Net sales $ 706,413 $ 674,538", "table"],
      ["Change 4.7 % (1.2)", "table"],
      ["After", "text"],
    ]);
  });

  it("keeps a row together when each cell wraps its text in <p> or <div> (Kroger)", () => {
    const html = `<table>
      <tr><td><p>Sales</p></td><td><p>$</p></td><td><div>147,123</div></td><td><p>$</p></td><td><div>150,039</div></td></tr>
      <tr><td><p>Total assets</p></td><td><p>$</p></td><td><div>52,000</div></td><td><p>$</p></td><td><div>49,000</div></td></tr>
      </table>`;
    expect(htmlToBlocks(html).map((b) => [b.text, b.kind])).toEqual([
      ["Sales $ 147,123 $ 150,039", "table"],
      ["Total assets $ 52,000 $ 49,000", "table"],
    ]);
  });

  it("keeps layout tables (bullets beside text) as 'text'", () => {
    const html = `<table><tr><td>•</td><td>We operate in a highly competitive industry.</td></tr>
      <tr><td>•</td><td>Our results depend on consumer spending.</td></tr></table>`;
    expect(htmlToBlocks(html).every((b) => b.kind === "text")).toBe(true);
  });

  it("decodes entities and collapses non-breaking spaces", () => {
    expect(blocks("<p>Walmart&#8217;s&#160;&#160;results&nbsp;improved</p>")).toEqual(["Walmart’s results improved"]);
  });

  it("drops blocks that are only zero-width spaces (Kroger) and strips them from text", () => {
    expect(blocks("<p>&#8203;</p><p>The Kroger&#8203; Co.</p>")).toEqual(["The Kroger Co."]);
  });

  it("ends a block at <br>", () => {
    expect(blocks("<div>Line one<br/>Line two</div>")).toEqual(["Line one", "Line two"]);
  });

  it("counts pages from CSS page breaks (before and after)", () => {
    const html = `<body><p>Cover</p><hr style="page-break-after:always"/><p>Page two</p>
      <div style="break-before: page">Page three</div></body>`;
    expect(htmlToBlocks(html).map(({ text, page }) => ({ text, page }))).toEqual([
      { text: "Cover", page: 1 },
      { text: "Page two", page: 2 },
      { text: "Page three", page: 3 },
    ]);
  });

  it("skips scripts and styles", () => {
    expect(blocks("<head><title>t</title><style>p{}</style></head><body><script>x()</script><p>Text</p></body>")).toEqual([
      "Text",
    ]);
  });
});

describe("removePageFurniture", () => {
  const b = (text: string, page: number) => ({ text, page, kind: "text" as const });

  it("drops bare page numbers and table-of-contents links", () => {
    expect(removePageFurniture([b("Real text.", 1), b("12", 1), b("F-3", 2), b("Table of Contents", 2)]).map((x) => x.text)).toEqual([
      "Real text.",
    ]);
  });

  it("drops a running header repeated on many pages, but keeps a subheading used a few times", () => {
    const blocks = Array.from({ length: 30 }, (_, p) => [
      b("Walmart Inc.", p + 1),
      b(`This is the body paragraph of the filing on page ${p + 1}.`, p + 1),
    ]).flat();
    blocks.push(b("Overview", 5), b("Overview", 12), b("Overview", 20));
    const kept = removePageFurniture(blocks).map((x) => x.text);
    expect(kept).not.toContain("Walmart Inc.");
    expect(kept.filter((t) => t === "Overview")).toHaveLength(3);
    expect(kept).toContain("This is the body paragraph of the filing on page 7.");
  });

  it("drops a running header whose page number changes (Target 2025: 38 passages had it as their subheading)", () => {
    const blocks = Array.from({ length: 30 }, (_, p) => [
      b(`TARGET CORPORATION 2025 Form 10-K ${p + 40}`, p + 1),
      b(`This is the body paragraph of the filing on page ${p + 1}.`, p + 1),
    ]).flat();
    const kept = removePageFurniture(blocks).map((x) => x.text);
    expect(kept.some((t) => t.startsWith("TARGET CORPORATION"))).toBe(false);
    expect(kept).toHaveLength(30);
  });

  it("drops short lines naming the table of contents, like 'RISK FACTORS Table of Contents'", () => {
    const kept = removePageFurniture([b("RISK FACTORS Table of Contents", 3), b("Supply Chain and Third-Party Risks", 3)]);
    expect(kept.map((x) => x.text)).toEqual(["Supply Chain and Third-Party Risks"]);
  });

  it("blanks numbers only in lines that have letters", () => {
    expect(runningHeaderKey("TARGET CORPORATION 2025 Form 10-K 51")).toBe("TARGET CORPORATION # Form #-K #");
    expect(runningHeaderKey("2025 2024")).toBeUndefined();
  });

  it("never drops Item headings or table rows", () => {
    const blocks = [b("Item 7", 1), { text: "2025 2024", page: 1, kind: "table" as const }];
    expect(removePageFurniture(blocks)).toHaveLength(2);
  });
});

describe("decodeFiling", () => {
  it("reads UTF-8", () => {
    expect(decodeFiling(new TextEncoder().encode("Walmart’s"))).toBe("Walmart’s");
  });

  it("falls back to Windows-1252 for older filings (0x93/0x94 are curly quotes)", () => {
    expect(decodeFiling(new Uint8Array([0x93, 0x68, 0x69, 0x94]))).toBe("“hi”");
  });
});
