import { describe, expect, test } from "bun:test";
import { MAX_DEPTH, parse, parseInline, safeHref, type Block, type Inline } from "./markup.ts";

// A compact, readable form of the tree: b(...), i(...), u(...), s(...), sp(...), rb(...), red(...),
// `code`, <link url>, @id, and plain text as is.
function show(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text": return n.text;
        case "code": return `\`${n.text}\``;
        case "link": return `<link ${n.url}>`;
        case "mention": return `@${n.id}`;
        case "color": return `${n.color}(${show(n.children)})`;
        default: {
          const short = { bold: "b", italic: "i", underline: "u", strike: "s", spoiler: "sp", rainbow: "rb" }[n.type];
          return `${short}(${show(n.children)})`;
        }
      }
    })
    .join("");
}
const inline = (src: string) => show(parseInline(src));
const blocks = (src: string) =>
  parse(src).map((b: Block) => (b.type === "codeblock" ? `code[${b.lang ?? ""}]:${b.text}` : `${b.type}:${show(b.children)}`));

describe("markdown", () => {
  test("each inline syntax", () => {
    expect(inline("**bold**")).toBe("b(bold)");
    expect(inline("*italic*")).toBe("i(italic)");
    expect(inline("_italic_")).toBe("i(italic)");
    expect(inline("__under__")).toBe("u(under)");
    expect(inline("~~strike~~")).toBe("s(strike)");
    expect(inline("`code`")).toBe("`code`");
    expect(inline("``a ` b``")).toBe("`a ` b`");
    expect(inline("||secret||")).toBe("sp(secret)");
    expect(inline("a **b** c")).toBe("a b(b) c");
  });

  test("flanking rules keep ordinary text alone", () => {
    expect(inline("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(inline("snake_case_name")).toBe("snake_case_name");
    expect(inline("__init__")).toBe("u(init)");
    expect(inline("a*b*c")).toBe("ai(b)c");
  });

  test("code blocks", () => {
    expect(blocks("```code block```")).toEqual(["code[]:code block"]);
    expect(blocks("```ts\nconst a = 1;\n  indented\n```")).toEqual(["code[ts]:const a = 1;\n  indented"]);
    expect(blocks("before\n```\nx\n```\nafter")).toEqual(["paragraph:before", "code[]:x", "paragraph:after"]);
    expect(blocks("```js```")).toEqual(["code[]:js"]);
    expect(blocks("``````")).toEqual(["paragraph:``````"]);
  });

  test("quotes", () => {
    expect(blocks("> quoted\n> **two**\nplain")).toEqual(["quote:quoted\nb(two)", "paragraph:plain"]);
    expect(blocks(">no space")).toEqual(["paragraph:>no space"]);
    expect(blocks("a > b")).toEqual(["paragraph:a > b"]);
    expect(blocks("\\> not a quote")).toEqual(["paragraph:> not a quote"]);
  });

  test("nothing is formatted inside code", () => {
    expect(inline("`**x** [red]y[/red] <@1> https://a.com`")).toBe("`**x** [red]y[/red] <@1> https://a.com`");
    expect(blocks("```\n**x** <@1>\n```")).toEqual(["code[]:**x** <@1>"]);
  });
});

describe("colours and effects", () => {
  test("palette tags and rainbow", () => {
    expect(inline("[cyan]hi[/cyan]")).toBe("cyan(hi)");
    for (const c of ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"]) {
      expect(inline(`[${c}]x[/${c}]`)).toBe(`${c}(x)`);
    }
    expect(inline("[rainbow]wow[/rainbow]")).toBe("rb(wow)");
  });

  test("unknown colours and unclosed tags stay as text", () => {
    expect(inline("[magenta]x[/magenta]")).toBe("[magenta]x[/magenta]");
    expect(inline("[RED]x[/RED]")).toBe("[RED]x[/RED]");
    expect(inline("[red]never closed")).toBe("[red]never closed");
    expect(inline("stray [/red] closer")).toBe("stray [/red] closer");
    expect(inline("[red][/red]")).toBe("[red][/red]");
  });
});

describe("combining", () => {
  test("nesting from the spec", () => {
    expect(inline("**[pink]bold pink[/pink]**")).toBe("b(pink(bold pink))");
    expect(inline("[rainbow]*italic rainbow*[/rainbow]")).toBe("rb(i(italic rainbow))");
    expect(inline("||[red]red spoiler[/red]||")).toBe("sp(red(red spoiler))");
    expect(inline("***both***")).toBe("b(i(both))");
    expect(inline("**bold *and italic* bold**")).toBe("b(bold i(and italic) bold)");
  });

  test("unclosed and mismatched markers stay literal", () => {
    expect(inline("**not closed")).toBe("**not closed");
    expect(inline("*a")).toBe("*a");
    expect(inline("~~a")).toBe("~~a");
    expect(inline("||a")).toBe("||a");
    expect(inline("`a")).toBe("`a");
    expect(inline("**a*")).toBe("**a*");
    expect(inline("**a ~~b** c~~")).toBe("b(a ~~b) c~~");
    expect(inline("[red]a **b[/red] c**")).toBe("red(a **b) c**");
    expect(inline("~single~")).toBe("~single~");
  });

  test("escaping", () => {
    expect(inline("\\*not italic\\*")).toBe("*not italic*");
    expect(inline("\\*\\*no\\*\\*")).toBe("**no**");
    expect(inline("\\[red]x[/red]")).toBe("[red]x[/red]");
    expect(inline("\\`x\\`")).toBe("`x`");
    expect(inline("\\<@1>")).toBe("<@1>");
    expect(inline("a\\b \\\\")).toBe("a\\b \\");
    expect(blocks("\\```x```")).toEqual(["paragraph:```x```"]);
  });

  test("deep nesting is capped", () => {
    const open = Array.from({ length: 12 }, (_, i) => `[${i % 2 ? "red" : "blue"}]`).join("");
    const nodes = parseInline(`${open}x`);
    // Every opener is unclosed, so it all comes back as one text.
    expect(show(nodes)).toBe(`${open}x`);

    const deep = Array.from({ length: 10 }, () => "[red]").join("") + "x" + Array.from({ length: 10 }, () => "[/red]").join("");
    let depth = 0;
    let node: Inline | undefined = parseInline(deep)[0];
    while (node && "children" in node) {
      depth++;
      node = node.children.find((c) => "children" in c) ?? undefined;
    }
    expect(depth).toBe(MAX_DEPTH);
    expect(show(parseInline(deep))).toContain("[red][red]x");
  });
});

describe("mentions", () => {
  test("work inside formatting but not inside code", () => {
    expect(inline("hi <@42>")).toBe("hi @42");
    expect(inline("**<@42>** ||<@7>|| [red]<@1>[/red]")).toBe("b(@42) sp(@7) red(@1)");
    expect(inline("`<@42>`")).toBe("`<@42>`");
    expect(inline("<@ 1> <@>")).toBe("<@ 1> <@>");
  });
});

describe("links", () => {
  test("http and https become links", () => {
    expect(inline("see https://example.com/a?b=c#d now")).toBe("see <link https://example.com/a?b=c#d> now");
    expect(inline("HTTP://EXAMPLE.COM")).toBe("<link HTTP://EXAMPLE.COM>");
  });

  test("trailing punctuation stays outside", () => {
    expect(inline("go to https://example.com.")).toBe("go to <link https://example.com>.");
    expect(inline("(see https://example.com)")).toBe("(see <link https://example.com>)");
    expect(inline("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe("<link https://en.wikipedia.org/wiki/Foo_(bar)>");
    expect(inline("https://a.com/x, https://b.com!")).toBe("<link https://a.com/x>, <link https://b.com>!");
    expect(inline("**https://a.com**")).toBe("b(<link https://a.com>)");
    expect(inline("||https://a.com||")).toBe("sp(<link https://a.com>)");
    expect(inline("[red]https://a.com[/red]")).toBe("red(<link https://a.com>)");
    expect(inline("https://a.com/snake_case_url")).toBe("<link https://a.com/snake_case_url>");
  });

  test("other schemes are not linked", () => {
    expect(inline("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(inline("javascript://example.com/%0aalert(1)")).toBe("javascript://example.com/%0aalert(1)");
    expect(inline("data:text/html,hi ftp://x.com")).toBe("data:text/html,hi ftp://x.com");
    expect(inline("xhttps://a.com")).toBe("xhttps://a.com");
    expect(inline("https://")).toBe("https://");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://a.com")).toBe("https://a.com/");
  });
});

describe("bad input is fast", () => {
  const patterns = [
    "*".repeat(2000),
    "*a".repeat(1000),
    "**a ".repeat(500),
    "_a".repeat(1000),
    "`".repeat(2000),
    "` ``".repeat(500),
    "[red]".repeat(400),
    "[/red]".repeat(333),
    "[red]**||~~__".repeat(150),
    "<@".repeat(1000),
    "\\".repeat(2000),
    "https://a.com/(".repeat(130),
    "```".repeat(666),
    "> **".repeat(500),
    "||".repeat(1000),
  ];
  for (const p of patterns) {
    test(`${JSON.stringify(p.slice(0, 12))}… (${p.length} chars)`, () => {
      const t = performance.now();
      const out = parse(p);
      expect(performance.now() - t).toBeLessThan(50);
      expect(out.length).toBeGreaterThan(0);
    });
  }
});
