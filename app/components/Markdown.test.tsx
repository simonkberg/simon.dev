import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

const html = (source: string): string => {
  const { container } = render(<Markdown source={source} />);
  return container.innerHTML;
};

describe("Markdown", () => {
  it("renders plain text", () => {
    expect(html("Hello, world!")).toBe("Hello, world!");
  });

  it("renders emphasis and strong", () => {
    expect(html("**Bold** and *italic*")).toBe(
      "<strong>Bold</strong> and <em>italic</em>",
    );
  });

  it("renders underline, strikethrough and inline code", () => {
    expect(html("`code` and ~~del~~ and __u__")).toBe(
      "<code>code</code> and <del>del</del> and <u>u</u>",
    );
  });

  it("renders line breaks", () => {
    expect(html("line one  \nline two")).toBe("line one<br>line two");
  });

  it("renders explicit links, with an optional title", () => {
    expect(
      html('[link](https://simon.dev) and [t](https://x.dev "title")'),
    ).toBe(
      '<a href="https://simon.dev">link</a> and <a href="https://x.dev" title="title">t</a>',
    );
  });

  it("autolinks bare urls", () => {
    expect(html("the source is here: https://github.com/example/repo")).toBe(
      'the source is here: <a href="https://github.com/example/repo">https://github.com/example/repo</a>',
    );
  });

  it("autolinks bracketed urls and email addresses", () => {
    expect(html("<https://auto.link> and <a@b.com>")).toBe(
      '<a href="https://auto.link">https://auto.link</a> and <a href="mailto:a@b.com">a@b.com</a>',
    );
  });

  it("renders images", () => {
    expect(html("![alt](https://simon.dev/a.png)")).toBe(
      '<img alt="alt" src="https://simon.dev/a.png">',
    );
  });

  it("honours backslash escapes", () => {
    expect(html("a \\* escaped")).toBe("a * escaped");
  });

  it("nests inline nodes", () => {
    expect(html("**bold with [a link](https://simon.dev)**")).toBe(
      '<strong>bold with <a href="https://simon.dev">a link</a></strong>',
    );
  });

  it("does not treat block syntax as blocks", () => {
    expect(html("# not a heading")).toBe("# not a heading");
  });

  describe("escaping", () => {
    it("renders html in the source as text", () => {
      render(<Markdown source="<script>alert(1)</script>" />);

      expect(document.querySelector("script")).toBeNull();
      expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    });

    it("escapes ampersands and quotes", () => {
      expect(html("& \"quotes\" 'single'")).toBe("&amp; \"quotes\" 'single'");
    });
  });

  describe("reference links without a definition", () => {
    it("renders a link with no href", () => {
      expect(html("[undefined-ref][9]")).toBe("<a>undefined-ref</a>");
    });

    it("renders an image with no src", () => {
      expect(html("![undefined-ref][9]")).toBe('<img alt="undefined-ref">');
    });
  });

  describe("url sanitisation", () => {
    it("drops javascript: link targets", () => {
      expect(html("[xss](javascript:alert(1))")).toBe("<a>xss</a>");
    });

    it("drops data: image targets", () => {
      expect(html("![x](data:text/html;base64,PHN2Zz4=)")).toBe(
        '<img alt="x">',
      );
    });
  });
});
