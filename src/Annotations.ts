import type * as Schema from "effect/Schema";

/**
 * Annotation key for HTTP status code.
 */
export const StatusKey = "funcho/status";

/**
 * Annotation key for response headers schema.
 */
export const HeadersKey = "funcho/headers";

/**
 * Annotation key for status text schema.
 */
export const StatusTextKey = "funcho/statusText";

/**
 * Annotation key for response content type.
 */
export const ContentTypeKey = "funcho/contentType";

/**
 * Annotate a schema with an HTTP status code.
 *
 * @example
 * ```ts
 * const UserSchema = Schema.Struct({ name: Schema.String }).pipe(
 *   Annotations.status(200)
 * );
 * ```
 */
export const status =
  <Code extends number>(code: Code) =>
  <S extends Schema.Top>(schema: S): S =>
    schema.annotate({ [StatusKey]: code }) as S;

/**
 * Annotate a schema with a response headers schema.
 *
 * @example
 * ```ts
 * const UserSchema = Schema.Struct({ name: Schema.String }).pipe(
 *   Annotations.status(201),
 *   Annotations.headers(Schema.Struct({ location: Schema.String }))
 * );
 * ```
 */
export const headers =
  <H extends Schema.Top>(headersSchema: H) =>
  <S extends Schema.Top>(schema: S): S =>
    schema.annotate({ [HeadersKey]: headersSchema }) as S;

/**
 * Annotate a schema with a status text schema.
 *
 * @example
 * ```ts
 * const TeapotSchema = Schema.Struct({ message: Schema.String }).pipe(
 *   Annotations.status(418),
 *   Annotations.statusText(Schema.Literal("I'm a teapot"))
 * );
 * ```
 */
export const statusText =
  <T extends Schema.Top>(textSchema: T) =>
  <S extends Schema.Top>(schema: S): S =>
    schema.annotate({ [StatusTextKey]: textSchema }) as S;

/**
 * Annotate a schema with a response content type.
 *
 * @example
 * ```ts
 * const PlainTextError = UnauthorizedError.pipe(
 *   Schema.encodeTo(Schema.String, {
 *     encode: SchemaGetter.transform(() => "Unauthorized"),
 *     decode: SchemaGetter.transform(() => new UnauthorizedError({})),
 *   }),
 *   Annotations.contentType("text/plain")
 * );
 * ```
 */
export const contentType =
  <T extends string>(type: T) =>
  <S extends Schema.Top>(schema: S): S =>
    schema.annotate({ [ContentTypeKey]: type }) as S;

/**
 * Extract the status code from an annotated schema.
 */
export const getStatus = (schema: Schema.Top): number | undefined => {
  const annotations = schema.ast.annotations;
  return annotations?.[StatusKey] as number | undefined;
};

/**
 * Extract the headers schema from an annotated schema.
 */
export const getHeaders = (schema: Schema.Top): Schema.Top | undefined => {
  const annotations = schema.ast.annotations;
  return annotations?.[HeadersKey] as Schema.Top | undefined;
};

/**
 * Extract the status text schema from an annotated schema.
 */
export const getStatusText = (schema: Schema.Top): Schema.Top | undefined => {
  const annotations = schema.ast.annotations;
  return annotations?.[StatusTextKey] as Schema.Top | undefined;
};

/**
 * Extract the content type from an annotated schema.
 */
export const getContentType = (schema: Schema.Top): string | undefined => {
  const annotations = schema.ast.annotations;
  return annotations?.[ContentTypeKey] as string | undefined;
};
