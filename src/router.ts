import type { Contract, HttpMethod, RouteDefinition } from "./contract.js";

export interface CompiledRoute {
  readonly pattern: string;
  readonly regex: RegExp;
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

const compilePattern = (
  pattern: string,
): { regex: RegExp; paramNames: string[] } => {
  const paramNames: string[] = [];
  const regexPattern = pattern.replace(/\{([^}]+)\}/g, (_, name) => {
    paramNames.push(name);
    return `(?<${name}>[^/]+)`;
  });
  return {
    regex: new RegExp(`^${regexPattern}$`),
    paramNames,
  };
};

export const compileContract = (
  contract: Contract,
): ReadonlyArray<CompiledRoute> => {
  const routes: CompiledRoute[] = [];
  for (const [pattern, methods] of Object.entries(contract)) {
    const compiled = compilePattern(pattern);
    routes.push({
      pattern,
      regex: compiled.regex,
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
    const match = route.regex.exec(pathname);
    if (match) {
      const definition = route.definitions[normalizedMethod];
      if (definition) {
        return {
          route,
          method: normalizedMethod,
          definition,
          params: match.groups ?? {},
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
