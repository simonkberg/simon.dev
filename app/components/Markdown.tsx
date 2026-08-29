import SimpleMarkdown, {
  type SingleASTNode,
} from "@khanacademy/simple-markdown";
import type { ReactNode } from "react";

/**
 * Renders inline markdown as React elements.
 *
 * simple-markdown ships its own React output, but it hand-rolls elements with
 * `Symbol.for("react.element")`. React 19 renamed that brand to
 * `react.transitional.element`, so those objects are rejected as children. Its
 * parser is pure, though, so we take the AST and do the output ourselves.
 *
 * `defaultInlineParse` only ever yields inline nodes — block rules (headings,
 * lists, tables, …) bail out while `state.inline` is set, and the inline rules
 * normalise into the set below: `escape` collapses into `text`, and `autolink`,
 * `mailto`, `url` and `reflink` all collapse into `link`.
 */

/** Nodes are `{ type: string; [key: string]: any }`, so fields are narrowed rather than cast. */
const asNodes = (value: unknown): SingleASTNode[] =>
  Array.isArray(value) ? value : [];

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Strips `javascript:`, `vbscript:` and `data:` targets, as the html output did. */
const asUrl = (value: unknown): string | undefined =>
  SimpleMarkdown.sanitizeUrl(asString(value)) ?? undefined;

const renderNodes = (nodes: SingleASTNode[]): ReactNode[] =>
  nodes.map((node, index) => renderNode(node, String(index)));

const renderNode = (node: SingleASTNode, key: string): ReactNode => {
  const children = () => renderNodes(asNodes(node["content"]));

  switch (node.type) {
    case "text":
      return asString(node["content"]);
    case "br":
      return <br key={key} />;
    case "em":
      return <em key={key}>{children()}</em>;
    case "strong":
      return <strong key={key}>{children()}</strong>;
    case "u":
      return <u key={key}>{children()}</u>;
    case "del":
      return <del key={key}>{children()}</del>;
    case "inlineCode":
      return <code key={key}>{asString(node["content"])}</code>;
    case "link":
      return (
        <a
          key={key}
          href={asUrl(node["target"])}
          title={asString(node["title"])}
        >
          {children()}
        </a>
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- chat images are arbitrary remote URLs, which `next/image` can only serve behind an open `remotePatterns`
        <img
          key={key}
          src={asUrl(node["target"])}
          alt={asString(node["alt"]) ?? ""}
          title={asString(node["title"])}
        />
      );
    default:
      return null;
  }
};

export interface MarkdownProps {
  source: string;
}

export const Markdown = ({ source }: MarkdownProps) => (
  <>{renderNodes(SimpleMarkdown.defaultInlineParse(source))}</>
);

export default Markdown;
