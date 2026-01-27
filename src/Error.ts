import * as Schema from "effect/Schema";
import { StatusKey } from "./Annotations.js";

/**
 * Symbol to identify route errors.
 */
export const RouteErrorTypeId = Symbol.for("funcho/RouteError");

/**
 * Create an error class with an embedded HTTP status code.
 *
 * The status code is stored as an annotation and can be extracted at runtime
 * for automatic response status mapping.
 *
 * @example
 * ```ts
 * class NotFoundError extends RouteError("NotFoundError", 404)({
 *   message: Schema.String,
 * }) {}
 *
 * class ValidationError extends RouteError("ValidationError", 400)({
 *   message: Schema.String,
 *   fields: Schema.Array(Schema.String),
 * }) {}
 *
 * // In a route handler:
 * if (!user) {
 *   return yield* new NotFoundError({ message: "User not found" });
 * }
 * ```
 */
export const RouteError = <Tag extends string, Status extends number>(
  tag: Tag,
  status: Status,
) => {
  return <const Fields extends Schema.Struct.Fields>(fields: Fields) => {
    // Create the error class using Schema.ErrorClass
    const BaseClass = Schema.ErrorClass<
      {
        readonly _tag: Tag;
      } & { readonly [K in keyof Fields]: Schema.Schema.Type<Fields[K]> }
    >(tag)(
      {
        _tag: Schema.tag(tag),
        ...fields,
      },
      {
        // Store status in annotations for extraction
        [StatusKey]: status,
        [RouteErrorTypeId as unknown as string]: true,
      },
    );

    // Add static properties
    const ErrorClass = BaseClass as typeof BaseClass & {
      readonly status: Status;
      readonly _tag: Tag;
    };

    Object.defineProperty(ErrorClass, "status", {
      value: status,
      writable: false,
    });
    Object.defineProperty(ErrorClass, "_tag", { value: tag, writable: false });

    return ErrorClass;
  };
};

/**
 * Type helper for any RouteError class.
 */
export type AnyRouteError = ReturnType<ReturnType<typeof RouteError>>;

/**
 * Type helper to extract status from a RouteError class.
 */
export type StatusOf<E> = E extends { readonly status: infer S } ? S : never;

/**
 * Type helper to extract the tag from a RouteError class.
 */
export type TagOf<E> = E extends { readonly _tag: infer T } ? T : never;

/**
 * Type helper to extract the instance type from a RouteError class.
 */
export type InstanceOf<E> = E extends new (
  fields: infer _F,
) => infer I
  ? I
  : never;

/**
 * Check if a class is a RouteError.
 */
export const isRouteError = (value: unknown): value is AnyRouteError => {
  return (
    typeof value === "function" &&
    "status" in value &&
    typeof value.status === "number" &&
    "_tag" in value &&
    typeof value._tag === "string"
  );
};

/**
 * Extract the status code from a RouteError class.
 */
export const getStatusFromError = (errorClass: AnyRouteError): number => {
  return (errorClass as { status: number }).status;
};

// Type for AST node to avoid type assertions on Schema.Top
interface ASTNode {
  _tag: string;
  annotations?: Record<string, unknown>;
  from?: ASTNode;
  propertySignatures?: Array<{
    name: string;
    type: { _tag: string; value?: string };
  }>;
}

/**
 * Extract the status code from an error schema.
 *
 * This handles both:
 * - Plain RouteError classes (status from static property)
 * - Transformed schemas via Schema.encodeTo (status from the underlying error class)
 *
 * For transformed schemas, we check the `to` property which contains the original error class.
 */
export const getStatusFromSchema = (schema: Schema.Top): number | undefined => {
  // First, check if it's a RouteError class with static status property
  if (isRouteError(schema)) {
    return getStatusFromError(schema);
  }

  // Cast to access ast property
  const schemaWithAst = schema as { ast: ASTNode };
  const ast = schemaWithAst.ast;

  // Check for status in the schema's own annotations
  const directStatus = ast.annotations?.[StatusKey] as number | undefined;
  if (directStatus !== undefined) {
    return directStatus;
  }

  // For transformed schemas (via encodeTo), check the `to` property which is the source error class
  const schemaObj = schema as { to?: unknown };
  if (schemaObj.to && isRouteError(schemaObj.to)) {
    return getStatusFromError(schemaObj.to);
  }

  return undefined;
};

/**
 * Extract the error tag from an error schema.
 *
 * This handles both plain RouteError classes and transformed schemas.
 */
export const getTagFromSchema = (schema: Schema.Top): string | undefined => {
  // Check if it's a RouteError class with static _tag property
  if (isRouteError(schema)) {
    return (schema as AnyRouteError)._tag;
  }

  // For transformed schemas (via encodeTo), check the `to` property which is the source error class
  const schemaObj = schema as { to?: unknown };
  if (schemaObj.to && isRouteError(schemaObj.to)) {
    return (schemaObj.to as AnyRouteError)._tag;
  }

  return undefined;
};

/**
 * Check if a schema is a transformed schema (via Schema.encodeTo).
 * In Effect 4, transformed schemas have `from` and `to` properties directly on the schema object.
 */
export const isTransformedSchema = (schema: Schema.Top): boolean => {
  // RouteError classes are not transformed
  if (isRouteError(schema)) {
    return false;
  }

  // Check for encodeTo transformation - it adds `from` and `to` properties
  const schemaObj = schema as { from?: unknown; to?: unknown };
  return schemaObj.from !== undefined && schemaObj.to !== undefined;
};

/**
 * Check if an error instance matches an error schema by tag.
 */
export const errorMatchesSchema = (
  error: unknown,
  schema: Schema.Top,
): boolean => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return false;
  }

  const errorTag = (error as { _tag: string })._tag;

  // Check if it's a RouteError class
  if (isRouteError(schema)) {
    return (schema as AnyRouteError)._tag === errorTag;
  }

  // Check for transformed schema
  const schemaTag = getTagFromSchema(schema);
  if (schemaTag) {
    return schemaTag === errorTag;
  }

  // Fallback: check if error is an instance of the schema (for class-based schemas)
  if (typeof schema === "function") {
    return error instanceof (schema as new (...args: unknown[]) => unknown);
  }

  return false;
};
