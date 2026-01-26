import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import * as Route from "../src/Route.js";
import * as Router from "../src/Router.js";

// Define test error schemas
class NotFoundError extends Schema.TaggedError<NotFoundError>()(
	"NotFoundError",
	{
		id: Schema.String,
	},
) {}

class ValidationError extends Schema.TaggedError<ValidationError>()(
	"ValidationError",
	{
		message: Schema.String,
	},
) {}

describe("Route", () => {
	test("make creates a minimal route with just operationId", () => {
		const route = Route.make(
			{ operationId: "healthCheck" },
			Effect.fn(function* () {}),
		);

		expect(route._tag).toBe("Route");
		expect(route.traits.operationId).toBe("healthCheck");
		expect(route.traits.input).toBe(Schema.Void);
		expect(route.traits.output).toBe(Schema.Void);
		expect(route.traits.errors).toEqual([]);
	});

	test("make creates a route with input/output schemas", () => {
		const inputSchema = Schema.Struct({ id: Schema.String });
		const outputSchema = Schema.Struct({
			id: Schema.String,
			name: Schema.String,
		});

		const route = Route.make(
			{
				operationId: "getUser",
				input: inputSchema,
				output: outputSchema,
			},
			Effect.fn(function* ({ id }) {
				return { id, name: "Alice" };
			}),
		);

		expect(route.traits.operationId).toBe("getUser");
		expect(route.traits.input).toBe(inputSchema);
		expect(route.traits.output).toBe(outputSchema);
		expect(route.traits.errors).toEqual([]);
	});

	test("make creates a route with error schemas", () => {
		const route = Route.make(
			{
				operationId: "getUser",
				input: Schema.Struct({ id: Schema.String }),
				output: Schema.Struct({ id: Schema.String, name: Schema.String }),
				errors: [NotFoundError],
			},
			Effect.fn(function* ({ id }) {
				if (id === "not-found") {
					return yield* new NotFoundError({ id });
				}
				return { id, name: "Alice" };
			}),
		);

		expect(route.traits.operationId).toBe("getUser");
		expect(route.traits.errors).toEqual([NotFoundError]);
	});

	test("handler can be executed", async () => {
		const route = Route.make(
			{
				operationId: "greet",
				input: Schema.Struct({ name: Schema.String }),
				output: Schema.Struct({ message: Schema.String }),
			},
			Effect.fn(function* ({ name }) {
				return { message: `Hello, ${name}!` };
			}),
		);

		const result = await Effect.runPromise(route.handler({ name: "World" }));
		expect(result).toEqual({ message: "Hello, World!" });
	});

	test("handler can yield effects", async () => {
		const route = Route.make(
			{
				operationId: "compute",
				input: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
				output: Schema.Struct({ sum: Schema.Number }),
			},
			Effect.fn(function* ({ a, b }) {
				const result = yield* Effect.succeed(a + b);
				return { sum: result };
			}),
		);

		const result = await Effect.runPromise(route.handler({ a: 10, b: 20 }));
		expect(result).toEqual({ sum: 30 });
	});

	test("handler can fail with typed errors", async () => {
		const route = Route.make(
			{
				operationId: "findUser",
				input: Schema.Struct({ id: Schema.String }),
				output: Schema.Struct({ id: Schema.String, name: Schema.String }),
				errors: [NotFoundError],
			},
			Effect.fn(function* ({ id }) {
				return yield* new NotFoundError({ id });
			}),
		);

		const result = await Effect.runPromiseExit(route.handler({ id: "123" }));
		expect(result._tag).toBe("Failure");
	});

	test("handler can fail with multiple error types", async () => {
		const route = Route.make(
			{
				operationId: "updateUser",
				input: Schema.Struct({ id: Schema.String, name: Schema.String }),
				output: Schema.Struct({ id: Schema.String, name: Schema.String }),
				errors: [NotFoundError, ValidationError],
			},
			Effect.fn(function* ({ id, name }) {
				if (id === "not-found") {
					return yield* new NotFoundError({ id });
				}
				if (name.length < 2) {
					return yield* new ValidationError({ message: "Name too short" });
				}
				return { id, name };
			}),
		);

		// Test NotFoundError
		const notFoundResult = await Effect.runPromiseExit(
			route.handler({ id: "not-found", name: "Alice" }),
		);
		expect(notFoundResult._tag).toBe("Failure");

		// Test ValidationError
		const validationResult = await Effect.runPromiseExit(
			route.handler({ id: "123", name: "A" }),
		);
		expect(validationResult._tag).toBe("Failure");

		// Test success
		const successResult = await Effect.runPromise(
			route.handler({ id: "123", name: "Alice" }),
		);
		expect(successResult).toEqual({ id: "123", name: "Alice" });
	});
});

describe("Router", () => {
	test("make creates an empty router", () => {
		const router = Router.make();

		expect(router._tag).toBe("Router");
		expect(router.routes).toEqual([]);
	});

	test("add appends routes to the router", () => {
		const route1 = Route.make(
			{ operationId: "route1" },
			Effect.fn(function* () {}),
		);

		const route2 = Route.make(
			{ operationId: "route2" },
			Effect.fn(function* () {}),
		);

		const router = Router.make().add(route1).add(route2);

		expect(router.routes.length).toBe(2);
		expect(router.routes[0]?.traits.operationId).toBe("route1");
		expect(router.routes[1]?.traits.operationId).toBe("route2");
	});

	test("router is immutable - add returns a new router", () => {
		const route = Route.make(
			{ operationId: "healthCheck" },
			Effect.fn(function* () {}),
		);

		const router1 = Router.make();
		const router2 = router1.add(route);

		expect(router1.routes.length).toBe(0);
		expect(router2.routes.length).toBe(1);
	});

	test("router preserves route types", () => {
		const getUser = Route.make(
			{
				operationId: "getUser",
				input: Schema.Struct({ id: Schema.String }),
				output: Schema.Struct({ id: Schema.String, name: Schema.String }),
				errors: [NotFoundError],
			},
			Effect.fn(function* ({ id }) {
				return { id, name: "Alice" };
			}),
		);

		const createUser = Route.make(
			{
				operationId: "createUser",
				input: Schema.Struct({ name: Schema.String }),
				output: Schema.Struct({ id: Schema.String }),
				errors: [ValidationError],
			},
			Effect.fn(function* () {
				return { id: "new-id" };
			}),
		);

		const app = Router.make().add(getUser).add(createUser);

		// Runtime check that routes are preserved
		expect(app.routes[0]?.traits.operationId).toBe("getUser");
		expect(app.routes[1]?.traits.operationId).toBe("createUser");
	});

	test("duplicate operationId causes type error", () => {
		const route1 = Route.make(
			{ operationId: "duplicate" },
			Effect.fn(function* () {}),
		);

		const route2 = Route.make(
			{ operationId: "duplicate" },
			Effect.fn(function* () {}),
		);

		const router = Router.make().add(route1);

		// @ts-expect-error - duplicate operationId should fail
		router.add(route2);

		// This should work - different operationId
		const route3 = Route.make(
			{ operationId: "unique" },
			Effect.fn(function* () {}),
		);
		router.add(route3);

		expect(true).toBe(true);
	});
});
