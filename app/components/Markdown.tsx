import SimpleMarkdown from "@khanacademy/simple-markdown";
import { Fragment, type ReactNode } from "react";

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
 * into `link`. `target` is optional because a `reflink` whose definition never
 * appears is parsed without one.
 *
 * simple-markdown types every node as `{ type: string; [key: string]: any }`,
 * so this is the shape the parser guarantees rather than one it declares.
 */
type InlineNode =
  | { type: "text" | "inlineCode"; content: string }
  | { type: "br" }
  | { type: "em" | "strong" | "u" | "del"; content: InlineNode[] }
  | { type: "link"; content: InlineNode[]; target?: string; title?: string }
  | { type: "image"; alt: string };

/** Strips `javascript:`, `vbscript:` and `data:` targets, as the html output did. */
const sanitizeUrl = (target?: string): string | undefined =>
  SimpleMarkdown.sanitizeUrl(target) ?? undefined;

const renderNodes = (nodes: InlineNode[]): ReactNode[] =>
  nodes.map((node, index) => renderNode(node, index));

/**
 * Excluding `undefined` from the return type is what keeps `InlineNode` honest:
 * the switch has no `default`, so dropping a case makes the function fall
 * through and TypeScript rejects it, rather than that node silently rendering
 * as nothing.
 */
const renderNode = (
  node: InlineNode,
  key: number,
): Exclude<ReactNode, undefined> => {
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
    case "link": {
      const href = sanitizeUrl(node.target);
      // A target that did not survive sanitising is not a link, so render just
      // the label. An `<a>` without `href` still picks up link styling while
      // being unclickable, and exposes no link role to assistive tech — the
      // appearance would contradict what the element actually is.
      return href === undefined ? (
        <Fragment key={key}>{renderNodes(node.content)}</Fragment>
      ) : (
        <a key={key} href={href} title={node.title}>
          {renderNodes(node.content)}
        </a>
      );
    }
    // Deliberately not embedded. Message content is user-supplied, so an
    // `<img>` would let anyone posting in the channel load an arbitrary remote
    // URL in every visitor's browser — a tracking pixel, an IP logger, or
    // unmoderated imagery. Discord does not render markdown images either, so
    // nothing legitimate is lost. The alt text is kept so the message reads.
    case "image":
      return node.alt;
  }
};

export interface MarkdownProps {
  source: string;
}

export const Markdown = ({ source }: MarkdownProps) => (
  <>{renderNodes(SimpleMarkdown.defaultInlineParse(source) as InlineNode[])}</>
);
