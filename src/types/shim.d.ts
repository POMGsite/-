// Tipos mínimos para rodar `tsc` quando @types/react não está instalado.
// Depois de `npm install` (que instala @types/react), este arquivo pode ser apagado.
declare module "react" {
  export type ReactNode = any;
  export type ReactElement = any;
  export const Fragment: any;
  export function createElement(...args: any[]): any;
}
declare module "react/jsx-runtime" {
  export const jsx: any; export const jsxs: any; export const Fragment: any;
}
declare module "react-dom/server" {
  export function renderToStaticMarkup(el: any): string;
}
declare namespace JSX {
  interface IntrinsicElements { [name: string]: any }
  type Element = any;
  interface IntrinsicAttributes { key?: any }
  interface ElementChildrenAttribute { children: {} }
}
