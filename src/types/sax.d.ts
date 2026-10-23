declare module "sax" {
  export interface QualifiedAttribute {
    name: string;
    value: string;
    prefix: string;
    local: string;
    uri: string;
  }

  export interface QualifiedTag {
    name: string;
    prefix: string;
    local: string;
    uri: string;
    attributes: Record<string, QualifiedAttribute>;
    isSelfClosing: boolean;
  }

  export interface SaxParser {
    onerror?: (error: Error) => void;
    ondoctype?: (doctype: string) => void;
    onattribute?: (attribute: QualifiedAttribute) => void;
    onopentag?: (tag: QualifiedTag) => void;
    onclosetag?: (name: string) => void;
    ontext?: (text: string) => void;
    oncdata?: (text: string) => void;
    write(xml: string): SaxParser;
    close(): SaxParser;
    resume(): SaxParser;
  }

  export function parser(strict: boolean, options?: { strictEntities?: boolean; xmlns?: boolean }): SaxParser;
}
