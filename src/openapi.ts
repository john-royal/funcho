import * as Schema from "effect/Schema";
import type { Contract, HttpMethod, RouteDefinition } from "./contract.js";
import { getHttpStatus } from "./schema.js";

export interface OpenAPIInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

export interface OpenAPISpec {
  readonly openapi: "3.0.3";
  readonly info: OpenAPIInfo;
  readonly paths: Record<string, Record<string, OpenAPIOperation>>;
  readonly components?: {
    readonly schemas?: Record<string, unknown>;
  };
}

export interface OpenAPIOperation {
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: ReadonlyArray<OpenAPIParameter>;
  readonly requestBody?: OpenAPIRequestBody;
  readonly responses: Record<string, OpenAPIResponse>;
}

export interface OpenAPIParameter {
  readonly name: string;
  readonly in: "path" | "query" | "header";
  readonly required: boolean;
  readonly schema: Record<string, unknown>;
  readonly description?: string;
}

export interface OpenAPIRequestBody {
  readonly required: boolean;
  readonly content: Record<
    string,
    { readonly schema: Record<string, unknown> }
  >;
}

export interface OpenAPIResponseHeader {
  readonly description?: string;
  readonly schema: Record<string, unknown>;
  readonly required?: boolean;
}

export interface OpenAPIResponse {
  readonly description: string;
  readonly headers?: Record<string, OpenAPIResponseHeader>;
  readonly content?: Record<
    string,
    { readonly schema: Record<string, unknown> }
  >;
}

const toJsonSchema = (schema: Schema.Top): Record<string, unknown> => {
  const standardSchema = Schema.toStandardJSONSchemaV1(schema);
  const jsonSchema = standardSchema["~standard"].jsonSchema.output({
    target: "draft-07",
  });
  const { $schema, ...rest } = jsonSchema as { $schema?: string } & Record<
    string,
    unknown
  >;
  return rest;
};

const convertPath = (path: string): string =>
  path.replace(/\{([^}]+)\}/g, "{$1}");

const buildParameters = (definition: RouteDefinition): OpenAPIParameter[] => {
  const parameters: OpenAPIParameter[] = [];
  if (definition.path) {
    for (const [name, schema] of Object.entries(definition.path)) {
      parameters.push({
        name,
        in: "path",
        required: true,
        schema: toJsonSchema(schema),
      });
    }
  }
  if (definition.query) {
    for (const [name, schema] of Object.entries(definition.query)) {
      const isOptional = schema.ast._tag === "Union" || name.endsWith("?");
      parameters.push({
        name,
        in: "query",
        required: !isOptional,
        schema: toJsonSchema(schema),
      });
    }
  }
  if (definition.headers) {
    for (const [name, schema] of Object.entries(definition.headers)) {
      parameters.push({
        name,
        in: "header",
        required: true,
        schema: toJsonSchema(schema),
      });
    }
  }
  return parameters;
};

const buildRequestBody = (
  definition: RouteDefinition,
): OpenAPIRequestBody | undefined => {
  if (!definition.body) return undefined;
  return {
    required: true,
    content: {
      "application/json": {
        schema: toJsonSchema(definition.body),
      },
    },
  };
};

const buildResponseHeaders = (
  definition: RouteDefinition,
): Record<string, OpenAPIResponseHeader> | undefined => {
  if (!definition.responseHeaders) return undefined;
  const headers: Record<string, OpenAPIResponseHeader> = {};
  for (const [name, schema] of Object.entries(definition.responseHeaders)) {
    headers[name] = {
      schema: toJsonSchema(schema),
    };
  }
  return headers;
};

const buildResponses = (
  definition: RouteDefinition,
): Record<string, OpenAPIResponse> => {
  const responses: Record<string, OpenAPIResponse> = {};
  const successStatus = getHttpStatus(definition.success) ?? 200;
  const responseHeaders = buildResponseHeaders(definition);
  responses[String(successStatus)] = {
    description: "Successful response",
    headers: responseHeaders,
    content: {
      "application/json": {
        schema: toJsonSchema(definition.success),
      },
    },
  };
  if (definition.failure) {
    const failureStatus = getHttpStatus(definition.failure) ?? 400;
    responses[String(failureStatus)] = {
      description: "Error response",
      content: {
        "application/json": {
          schema: toJsonSchema(definition.failure),
        },
      },
    };
  }
  return responses;
};

const buildOperation = (definition: RouteDefinition): OpenAPIOperation => {
  const operation: OpenAPIOperation = {
    description: definition.description,
    parameters: buildParameters(definition),
    requestBody: buildRequestBody(definition),
    responses: buildResponses(definition),
  };
  return operation;
};

export const OpenAPI = {
  from: <C extends Contract>(contract: C, info: OpenAPIInfo): OpenAPISpec => {
    const paths: Record<string, Record<string, OpenAPIOperation>> = {};
    for (const [path, methods] of Object.entries(contract)) {
      const openApiPath = convertPath(path);
      paths[openApiPath] = {};
      for (const [method, definition] of Object.entries(methods) as [
        HttpMethod,
        RouteDefinition,
      ][]) {
        if (definition) {
          paths[openApiPath][method] = buildOperation(definition);
        }
      }
    }
    return {
      openapi: "3.0.3",
      info,
      paths,
    };
  },
};
