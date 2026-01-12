import * as Schema from "effect/Schema";

export class ValidationError extends Schema.ErrorClass<ValidationError>(
  "ValidationError",
)(
  {
    message: Schema.String,
    issues: Schema.Array(Schema.Unknown),
  },
  { httpStatus: 400 },
) {}

export class NotFoundError extends Schema.ErrorClass<NotFoundError>(
  "NotFoundError",
)(
  {
    message: Schema.String,
  },
  { httpStatus: 404 },
) {}

export class MethodNotAllowedError extends Schema.ErrorClass<MethodNotAllowedError>(
  "MethodNotAllowedError",
)(
  {
    message: Schema.String,
    allowed: Schema.Array(Schema.String),
  },
  { httpStatus: 405 },
) {}

export class InternalServerError extends Schema.ErrorClass<InternalServerError>(
  "InternalServerError",
)(
  {
    message: Schema.String,
  },
  { httpStatus: 500 },
) {}
