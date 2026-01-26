import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Route traits define the metadata for a route.
 */
export interface Traits<
	TOperationId extends string = string,
	TInput extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
	TOutput extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
	TErrors extends
		ReadonlyArray<Schema.Schema.AnyNoContext> = ReadonlyArray<Schema.Schema.AnyNoContext>,
> {
	readonly operationId: TOperationId;
	readonly input?: TInput;
	readonly output?: TOutput;
	readonly errors?: TErrors;
}

/**
 * Converts an array of error schemas to a union type.
 */
type ErrorsToUnion<T extends ReadonlyArray<Schema.Schema.AnyNoContext>> =
	T extends readonly [] ? never : Schema.Schema.Type<T[number]>;

/**
 * A Route combines traits (metadata including schemas) with an Effect handler.
 */
export interface Route<
	TOperationId extends string = string,
	TInput extends Schema.Schema.AnyNoContext = typeof Schema.Void,
	TOutput extends Schema.Schema.AnyNoContext = typeof Schema.Void,
	TErrors extends ReadonlyArray<Schema.Schema.AnyNoContext> = readonly [],
	R = never,
> {
	readonly _tag: "Route";
	readonly traits: {
		readonly operationId: TOperationId;
		readonly input: TInput;
		readonly output: TOutput;
		readonly errors: TErrors;
	};
	readonly handler: (
		input: Schema.Schema.Type<TInput>,
	) => Effect.Effect<Schema.Schema.Type<TOutput>, ErrorsToUnion<TErrors>, R>;
}

export type AnyRoute = Route<string, any, any, any, any>;

/**
 * Create a new Route with the given traits and handler.
 */
export const make = <
	const TOperationId extends string,
	TInput extends Schema.Schema.AnyNoContext = typeof Schema.Void,
	TOutput extends Schema.Schema.AnyNoContext = typeof Schema.Void,
	const TErrors extends ReadonlyArray<Schema.Schema.AnyNoContext> = readonly [],
	R = never,
>(
	traits: {
		readonly operationId: TOperationId;
		readonly input?: TInput;
		readonly output?: TOutput;
		readonly errors?: TErrors;
	},
	handler: (
		input: Schema.Schema.Type<TInput>,
	) => Effect.Effect<Schema.Schema.Type<TOutput>, ErrorsToUnion<TErrors>, R>,
): Route<TOperationId, TInput, TOutput, TErrors, R> => ({
	_tag: "Route",
	traits: {
		operationId: traits.operationId,
		input: (traits.input ?? Schema.Void) as TInput,
		output: (traits.output ?? Schema.Void) as TOutput,
		errors: (traits.errors ?? []) as unknown as TErrors,
	},
	handler,
});
