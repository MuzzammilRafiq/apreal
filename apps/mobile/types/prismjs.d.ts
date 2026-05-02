declare module "prismjs" {
  export type Token = {
    type: string;
    content: string | (Token | string)[];
  };

  export const languages: Record<string, any>;
  export function tokenize(code: string, grammar: any): (Token | string)[];

  const Prism: {
    languages: Record<string, any>;
    tokenize(code: string, grammar: any): (Token | string)[];
    Token: Token;
  };

  export default Prism;
}

declare module "prismjs/components/*";
