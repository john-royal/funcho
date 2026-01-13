import { type MatchFunction, match } from "path-to-regexp";
import type { Contract, HttpMethod, RouteDefinition } from "./contract.js";

export interface CompiledRoute {
  readonly pattern: string;
  readonly matchFn: MatchFunction<Record<string, string>>;
  readonly paramNames: ReadonlyArray<string>;
  readonly methods: ReadonlyArray<HttpMethod>;
  readonly definitions: Partial<Record<HttpMethod, RouteDefinition>>;
}

export interface RouteMatch {
  readonly route: CompiledRoute;
  readonly method: HttpMethod;
  readonly definition: RouteDefinition;
  readonly params: Record<string, string>;
}

/**
 * Escapes special path-to-regexp characters in static path segments.
 * Characters that have special meaning in path-to-regexp need to be escaped with backslash.
 */
const escapeSpecialChars = (segment: string): string =>
  segment.replace(/[+*?()[\]\\]/g, "\\$&");

/**
 * Transforms `{param}` syntax to `:param` syntax for path-to-regexp compatibility,
 * while escaping special characters in static segments.
 */
const transformPattern = (pattern: string): string => {
  // Split by {param} patterns, escape static parts, then rejoin with :param
  const parts = pattern.split(/(\{[^}]+\})/g);
  return parts
    .map((part) => {
      if (part.startsWith("{") && part.endsWith("}")) {
        // Convert {param} to :param
        return `:${part.slice(1, -1)}`;
      }
      // Escape special chars in static segments
      return escapeSpecialChars(part);
    })
    .join("");
};

/**
 * Extracts parameter names from the `{param}` syntax.
 */
const extractParamNames = (pattern: string): string[] => {
  const names: string[] = [];
  pattern.replace(/\{([^}]+)\}/g, (_, name) => {
    names.push(name);
    return "";
  });
  return names;
};

const compilePattern = (
  pattern: string,
): { matchFn: MatchFunction<Record<string, string>>; paramNames: string[] } => {
  const paramNames = extractParamNames(pattern);
  const transformed = transformPattern(pattern);
  // decode: false - we handle decoding in the handler based on route's decodePath option
  const matchFn = match<Record<string, string>>(transformed, { decode: false });
  return { matchFn, paramNames };
};

export const compileContract = (
  contract: Contract,
): ReadonlyArray<CompiledRoute> => {
  const routes: CompiledRoute[] = [];
  for (const [pattern, methods] of Object.entries(contract)) {
    const compiled = compilePattern(pattern);
    routes.push({
      pattern,
      matchFn: compiled.matchFn,
      paramNames: compiled.paramNames,
      methods: Object.keys(methods) as HttpMethod[],
      definitions: methods,
    });
  }
  return routes;
};

export const matchRoute = (
  routes: ReadonlyArray<CompiledRoute>,
  pathname: string,
  method: string,
):
  | RouteMatch
  | {
      readonly matched: false;
      readonly allowedMethods?: ReadonlyArray<HttpMethod>;
    } => {
  const normalizedMethod = method.toLowerCase() as HttpMethod;
  for (const route of routes) {
    const result = route.matchFn(pathname);
    if (result) {
      const definition = route.definitions[normalizedMethod];
      if (definition) {
        return {
          route,
          method: normalizedMethod,
          definition,
          params: result.params,
        };
      }
      return { matched: false, allowedMethods: route.methods };
    }
  }
  return { matched: false };
};

export const isRouteMatch = (
  result:
    | RouteMatch
    | {
        readonly matched: false;
        readonly allowedMethods?: ReadonlyArray<HttpMethod>;
      },
): result is RouteMatch => !("matched" in result);
