// 本地类型垫片：当前脚手架的 package.json 未包含 @types/react（原快照 tsc 即不可用）。
// 为遵守“不新增依赖”，这里只为界面文件实际用到的 React API 补充最小类型，
// 业务文件（schedulingRules / schedulingStore）仍由 TS 严格检查。
// 若日后在 package.json 中补入 @types/react，删除本文件即可。

declare module "react" {
  export function useSyncExternalStore<T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
  ): T;
  export function useState<T>(
    initial: T | (() => T),
  ): [T, (value: T | ((prev: T) => T)) => void];
  export function useMemo<T>(factory: () => T, deps: unknown[]): T;

  const React: {
    StrictMode: (props: { children?: unknown }) => unknown;
  };
  export default React;
}

declare module "react-dom/client" {
  export function createRoot(container: Element | null): {
    render(element: unknown): void;
  };
}

declare module "react/jsx-runtime" {
  export const Fragment: unique symbol;
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: unknown;
  }
}
