import SimpleMarkdown from "@khanacademy/simple-markdown";
import type { ReactNode } from "react";

/**
 * Renders inline markdown as React elements.
 *
 * simple-markdown ships its own React output, but it hand-rolls elements with
 * `Symbol.for("react.element")`. React 19 renamed that brand to
 * `react.transitional.element`, so those objects are rejected as children. Its
 * parser is pure, though, so we take the AST and do the output ourselves.
 */

/**
 * Every node `defaultInlineParse()` can produce. Block rules bail out while
 * `state.inline` is set, and the inline rules normalise into this set: `escape`
 * collapses into `text`, and `autolink`, `mailto`, `url` and `reflink` collapse
 * into `link`. `target` is optional because a `reflink`/`refimage` whose
 * definition never appears is parsed without one.
 *
 * simple-markdown types every node as `{ type: string; [key: string]: any }`,
 * so this is the shape the parser guarantees rather than one it declares.
 */
type InlineNode =
  | { type: "text" | "inlineCode"; content: string }
  | { type: "br" }
  | { type: "em" | "strong" | "u" | "del"; content: InlineNode[] }
  | { type: "link"; content: InlineNode[]; target?: string; title?: string }
  | { type: "image"; alt: string; target?: string; title?: string };

/** Strips `javascript:`, `vbscript:` and `data:` targets, as the html output did. */
const sanitizeUrl = (target?: string): string | undefined =>
  SimpleMarkdown.sanitizeUrl(target) ?? undefined;

const renderNodes = (nodes: InlineNode[]): ReactNode[] =>
  nodes.map((node, index) => renderNode(node, String(index)));

const renderNode = (node: InlineNode, key: string): ReactNode => {
  switch (node.type) {
    case "text":
      return node.content;
    case "br":
      return <br key={key} />;
    case "em":
      return <em key={key}>{renderNodes(node.content)}</em>;
    case "strong":
      return <strong key={key}>{renderNodes(node.content)}</strong>;
    case "u":
      return <u key={key}>{renderNodes(node.content)}</u>;
    case "del":
      return <del key={key}>{renderNodes(node.content)}</del>;
    case "inlineCode":
      return <code key={key}>{node.content}</code>;
    case "link":
      return (
        <a key={key} href={sanitizeUrl(node.target)} title={node.title}>
          {renderNodes(node.content)}
        </a>
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- chat images are arbitrary remote URLs, which `next/image` can only serve behind an open `remotePatterns`
        <img
          key={key}
          src={sanitizeUrl(node.target)}
          alt={node.alt}
          title={node.title}
        />
      );
  }
};

export interface MarkdownProps {
  source: string;
}

export const Markdown = ({ source }: MarkdownProps) => (
  <>{renderNodes(SimpleMarkdown.defaultInlineParse(source) as InlineNode[])}</>
);

export default Markdown;
