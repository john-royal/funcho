import * as Schema from "effect/Schema";
import type * as StreamModule from "effect/Stream";

/**
 * Symbol used to identify the Stream marker type.
 */
export const StreamTypeId = Symbol.for("funcho/Stream");

/**
 * A marker schema that indicates a streaming body.
 *
 * When used as a request body schema, the handler receives a `Stream<Uint8Array>`.
 * When used as a response body schema, the handler should return a `Stream<Uint8Array>`.
 *
 * @example
 * ```ts
 * // Streaming request body
 * const uploadFile = Route.post("/files", {
 *   body: Stream,
 *   success: Schema.Struct({ id: Schema.String }).pipe(Route.status(201)),
 * }, Effect.fnUntraced(function* ({ body }) {
 *   // body is Stream<Uint8Array>
 *   const id = yield* FileStorage.upload(body);
 *   return { id };
 * }));
 *
 * // Streaming response
 * const streamEvents = Route.get("/events", {
 *   success: Stream.pipe(
 *     Route.status(200),
 *     Route.headers(Schema.Struct({ "content-type": Schema.Literal("text/event-stream") }))
 *   ),
 * }, Effect.fnUntraced(function* () {
 *   const events = yield* EventSource.subscribe();
 *   return { body: events, headers: { "content-type": "text/event-stream" } };
 * }));
 * ```
 */
export const Stream: Schema.Schema<StreamModule.Stream<Uint8Array>> =
  Schema.declare(
    (u): u is StreamModule.Stream<Uint8Array> => {
      // Check for Effect Stream type signature
      return (
        typeof u === "object" && u !== null && Symbol.for("effect/Stream") in u
      );
    },
    {
      identifier: "Stream<Uint8Array>",
      [StreamTypeId]: true,
    },
  );

/**
 * Type alias for the Stream schema type.
 */
export type Stream = typeof Stream;

/**
 * Check if a schema is a Stream marker.
 */
export const isStream = (schema: Schema.Top): boolean => {
  const annotations = schema.ast.annotations;
  return annotations?.[StreamTypeId as unknown as string] === true;
};
