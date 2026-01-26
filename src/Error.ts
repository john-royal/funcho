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
