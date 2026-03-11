import type { Root } from 'chat';

type RootContent = Root['children'][number];

function hasChildren(node: RootContent): node is RootContent & { children: RootContent[] } {
  return 'children' in node && Array.isArray(node.children);
}

function inlineNodeToText(node: RootContent): string {
  if (node.type === 'text') {
    return node.value;
  }

  if (node.type === 'inlineCode') {
    return node.value;
  }

  if (node.type === 'image') {
    return node.alt ?? '';
  }

  if (node.type === 'link') {
    const label = node.children.map((child) => inlineNodeToText(child)).join('');
    return label || node.url;
  }

  if (node.type === 'break') {
    return '\n';
  }

  if (hasChildren(node)) {
    return node.children.map((child) => inlineNodeToText(child)).join('');
  }

  return '';
}

function blockNodeToText(node: RootContent): string {
  if (node.type === 'code') {
    return node.value;
  }

  if (node.type === 'blockquote') {
    return node.children.map((child) => blockNodeToText(child)).join('\n');
  }

  if (node.type === 'list') {
    return node.children.map((item) => `- ${blockNodeToText(item)}`).join('\n');
  }

  if (node.type === 'listItem') {
    return node.children.map((child) => blockNodeToText(child)).join('\n');
  }

  if (node.type === 'table') {
    return node.children
      .map((row) =>
        row.children.map((cell) => cell.children.map(inlineNodeToText).join('')).join(' | ')
      )
      .join('\n');
  }

  return inlineNodeToText(node);
}

export function toPlainTextPreserveBreaks(ast: Root): string {
  const blocks = ast.children
    .map((node) => blockNodeToText(node))
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  return blocks.join('\n').replace(/\n{3,}/g, '\n\n');
}
