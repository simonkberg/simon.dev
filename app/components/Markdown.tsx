import SimpleMarkdown from "@khanacademy/simple-markdown";
import { Fragment, type ReactNode } from "react";

/**
 * Renders inline markdown. We use simple-markdown's parser but not its React
 * output, which builds React 18 elements that React 19 rejects.
 */

/**
 * What `defaultInlineParse()` produces — the library types every node as
 * `{ type: string; [key: string]: any }`. `target` is absent on a `reflink`
 * whose definition never appears.
 */
type InlineNode =
  | { type: "text" | "inlineCode"; content: string }
  | { type: "br" }
  | { type: "em" | "strong" | "u" | "del"; content: InlineNode[] }
  | { type: "link"; content: InlineNode[]; target?: string; title?: string }
  | { type: "image"; alt: string };

/** Strips `javascript:`, `vbscript:` and `data:` targets. */
const sanitizeUrl = (target?: string): string | undefined =>
  SimpleMarkdown.sanitizeUrl(target) ?? undefined;

const renderNodes = (nodes: InlineNode[]): ReactNode[] =>
  nodes.map((node, index) => renderNode(node, index));

/** No `default`: excluding `undefined` makes a missing case a compile error. */
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
      // Not a link: an href-less `<a>` looks like one but has no link role.
      return href === undefined ? (
        <Fragment key={key}>{renderNodes(node.content)}</Fragment>
      ) : (
        <a key={key} href={href} title={node.title}>
          {renderNodes(node.content)}
        </a>
      );
    }
    // Never an `<img>`: message authors choose the URL (tracking pixel, IP
    // logger). Discord doesn't render markdown images either.
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
