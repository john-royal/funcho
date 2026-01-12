import * as Schema from "effect/Schema";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly httpStatus?: number | undefined;
      readonly contentType?: string | undefined;
    }
  }
}

export const httpStatus = <S extends Schema.Top>(
  schema: S,
  status: number,
): S["~rebuild.out"] => schema.pipe(Schema.annotate({ httpStatus: status }));

export const contentType = <S extends Schema.Top>(
  schema: S,
  type: string,
): S["~rebuild.out"] => schema.pipe(Schema.annotate({ contentType: type }));

export const getHttpStatus = (schema: Schema.Top): number | undefined =>
  Schema.resolveInto(schema)?.httpStatus;

export const getContentType = (schema: Schema.Top): string | undefined =>
  Schema.resolveInto(schema)?.contentType;

export const StreamBody = Schema.instanceOf(ReadableStream).pipe(
  Schema.annotate({ contentType: "application/octet-stream" }),
);

export const isStreamSchema = (schema: Schema.Top): boolean =>
  getContentType(schema) === "application/octet-stream";
