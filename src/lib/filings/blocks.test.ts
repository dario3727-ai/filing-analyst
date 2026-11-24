import { describe, expect, it } from "vitest";
import { decodeFiling, htmlToBlocks } from "@/lib/filings/blocks";

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
    expect(htmlToBlocks(html)).toEqual([
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

describe("decodeFiling", () => {
  it("reads UTF-8", () => {
    expect(decodeFiling(new TextEncoder().encode("Walmart’s"))).toBe("Walmart’s");
  });

  it("falls back to Windows-1252 for older filings (0x93/0x94 are curly quotes)", () => {
    expect(decodeFiling(new Uint8Array([0x93, 0x68, 0x69, 0x94]))).toBe("“hi”");
  });
});
