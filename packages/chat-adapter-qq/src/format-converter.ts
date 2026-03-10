import { BaseFormatConverter, parseMarkdown, stringifyMarkdown, type Root } from 'chat';

/**
 * @todo
 */
export class QQFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
}
