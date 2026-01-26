import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import * as Gate from "../src/Gate.js";
import * as Handler from "../src/Handler.js";
import * as Headers from "../src/Headers.js";
import * as Route from "../src/Route.js";
import * as Router from "../src/Router.js";

// Define test error schemas
class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	{
		message: Schema.String,
	},
) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
	"NotFoundError",
	{
		id: Schema.String,
	},
) {}

// Helper to create a Request
const createRequest = (
	operationId: string,
	body?: unknown,
	headers?: Record<string, string>,
): Request => {
	return new Request(`http://localhost/operation/${operationId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: body !== undefined ? JSON.stringify(body) : null,
	});
};

describe("Gate", () => {
	test("make creates a gate with empty routes", () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {}),
		);

		expect(gate._tag).toBe("Gate");
		expect(gate.routes).toEqual([]);
		expect(gate.traits.errors).toEqual([]);
	});

	test("make creates a gate with error traits", () => {
		const gate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* () {}),
		);

		expect(gate.traits.errors).toEqual([UnauthorizedError]);
	});

	test("add creates a gated route", () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {}),
		);

		const route = Route.make(
			{ operationId: "test" },
			Effect.fn(function* () {}),
		);

		const gatedGate = gate.add(route);

		expect(gatedGate.routes.length).toBe(1);
		expect(gatedGate.routes[0]?._tag).toBe("GatedRoute");
		expect(gatedGate.routes[0]?.traits.operationId).toBe("test");
	});

	test("gated route merges gate errors with route errors", () => {
		const gate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* () {}),
		);

		const route = Route.make(
			{
				operationId: "test",
				errors: [NotFoundError],
			},
			Effect.fn(function* () {
				return yield* new NotFoundError({ id: "123" });
			}),
		);

		const gatedGate = gate.add(route);

		expect(gatedGate.routes[0]?.traits.errors).toHaveLength(2);
		expect(gatedGate.routes[0]?.traits.errors).toContain(UnauthorizedError);
		expect(gatedGate.routes[0]?.traits.errors).toContain(NotFoundError);
	});

	test("gate can be added to router", () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {}),
		);

		const route = Route.make(
			{ operationId: "test" },
			Effect.fn(function* () {}),
		);

		const gatedGate = gate.add(route);
		const router = Router.make().add(gatedGate);

		expect(router.routes.length).toBe(1);
	});

	test("multiple routes can be added to a gate", () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {}),
		);

		const route1 = Route.make(
			{ operationId: "route1" },
			Effect.fn(function* () {}),
		);

		const route2 = Route.make(
			{ operationId: "route2" },
			Effect.fn(function* () {}),
		);

		const gatedGate = gate.add(route1).add(route2);

		expect(gatedGate.routes.length).toBe(2);
		expect(gatedGate.routes[0]?.traits.operationId).toBe("route1");
		expect(gatedGate.routes[1]?.traits.operationId).toBe("route2");
	});
});

describe("Gate with Handler", () => {
	test("gate handler runs before route handler", async () => {
		const executionOrder: string[] = [];

		const gate = Gate.make(
			{},
			Effect.fn(function* () {
				executionOrder.push("gate");
			}),
		);

		const route = Route.make(
			{ operationId: "test" },
			Effect.fn(function* () {
				executionOrder.push("route");
			}),
		);

		const app = Router.make().add(gate.add(route));
		const handler = Handler.toFetch(app);

		await handler(createRequest("test"));

		expect(executionOrder).toEqual(["gate", "route"]);
	});

	test("gate can provide context to routes", async () => {
		interface AuthContext {
			userId: string;
			role: string;
		}

		const AuthGate = Gate.make(
			{},
			Effect.fn(function* (): Effect.fn.Return<AuthContext> {
				return { userId: "user-123", role: "admin" };
			}),
		);

		const route = Route.make(
			{
				operationId: "getProfile",
				output: Schema.Struct({ userId: Schema.String, role: Schema.String }),
			},
			Effect.fn(function* () {
				const auth = yield* AuthGate.Context;
				return { userId: auth.userId, role: auth.role };
			}),
		);

		const app = Router.make().add(AuthGate.add(route));
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("getProfile"));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ userId: "user-123", role: "admin" });
	});

	test("gate errors are returned correctly", async () => {
		const AuthGate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* () {
				return yield* new UnauthorizedError({ message: "Invalid token" });
			}),
		);

		const route = Route.make(
			{ operationId: "protected" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(AuthGate.add(route));
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("protected"));

		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			error: { _tag: string; message: string };
		};
		expect(body.error._tag).toBe("UnauthorizedError");
		expect(body.error.message).toBe("Invalid token");
	});

	test("gate can check headers for auth", async () => {
		const AuthGate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* () {
				const token = yield* Headers.get("Authorization");
				if (!token) {
					return yield* new UnauthorizedError({ message: "No token provided" });
				}
				if (token !== "Bearer valid-token") {
					return yield* new UnauthorizedError({ message: "Invalid token" });
				}
				return { userId: "user-123" };
			}),
		);

		const route = Route.make(
			{
				operationId: "protected",
				output: Schema.Struct({ message: Schema.String }),
			},
			Effect.fn(function* () {
				const auth = yield* AuthGate.Context;
				return { message: `Hello, ${auth.userId}!` };
			}),
		);

		const app = Router.make().add(AuthGate.add(route));
		const handler = Handler.toFetch(app);

		// Without token
		const noTokenResponse = await handler(createRequest("protected"));
		expect(noTokenResponse.status).toBe(400);
		const noTokenBody = (await noTokenResponse.json()) as {
			error: { message: string };
		};
		expect(noTokenBody.error.message).toBe("No token provided");

		// With invalid token
		const invalidResponse = await handler(
			createRequest("protected", undefined, { Authorization: "Bearer bad" }),
		);
		expect(invalidResponse.status).toBe(400);
		const invalidBody = (await invalidResponse.json()) as {
			error: { message: string };
		};
		expect(invalidBody.error.message).toBe("Invalid token");

		// With valid token
		const validResponse = await handler(
			createRequest("protected", undefined, {
				Authorization: "Bearer valid-token",
			}),
		);
		expect(validResponse.status).toBe(200);
		const validBody = await validResponse.json();
		expect(validBody).toEqual({ message: "Hello, user-123!" });
	});

	test("route errors are still returned correctly through gate", async () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {
				return { passed: true };
			}),
		);

		const route = Route.make(
			{
				operationId: "findItem",
				input: Schema.Struct({ id: Schema.String }),
				errors: [NotFoundError],
			},
			Effect.fn(function* ({ id }) {
				return yield* new NotFoundError({ id });
			}),
		);

		const app = Router.make().add(gate.add(route));
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("findItem", { id: "abc" }));

		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			error: { _tag: string; id: string };
		};
		expect(body.error._tag).toBe("NotFoundError");
		expect(body.error.id).toBe("abc");
	});

	test("router can mix gated and non-gated routes", async () => {
		const AuthGate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* () {
				const token = yield* Headers.get("Authorization");
				if (!token) {
					return yield* new UnauthorizedError({ message: "Auth required" });
				}
				return { userId: "user-123" };
			}),
		);

		const publicRoute = Route.make(
			{
				operationId: "public",
				output: Schema.Struct({ message: Schema.String }),
			},
			Effect.fn(function* () {
				return { message: "This is public" };
			}),
		);

		const protectedRoute = Route.make(
			{
				operationId: "protected",
				output: Schema.Struct({ message: Schema.String }),
			},
			Effect.fn(function* () {
				const auth = yield* AuthGate.Context;
				return { message: `Private for ${auth.userId}` };
			}),
		);

		const app = Router.make()
			.add(publicRoute)
			.add(AuthGate.add(protectedRoute));

		const handler = Handler.toFetch(app);

		// Public route works without auth
		const publicResponse = await handler(createRequest("public"));
		expect(publicResponse.status).toBe(200);
		const publicBody = await publicResponse.json();
		expect(publicBody).toEqual({ message: "This is public" });

		// Protected route requires auth
		const noAuthResponse = await handler(createRequest("protected"));
		expect(noAuthResponse.status).toBe(400);

		// Protected route works with auth
		const authResponse = await handler(
			createRequest("protected", undefined, { Authorization: "token" }),
		);
		expect(authResponse.status).toBe(200);
		const authBody = await authResponse.json();
		expect(authBody).toEqual({ message: "Private for user-123" });
	});

	test("duplicate operationId detection works with gates", () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {}),
		);

		const route1 = Route.make(
			{ operationId: "duplicate" },
			Effect.fn(function* () {}),
		);

		const route2 = Route.make(
			{ operationId: "duplicate" },
			Effect.fn(function* () {}),
		);

		const gatedGate = gate.add(route1);

		// First add should work
		const router = Router.make().add(gatedGate);
		expect(router.routes.length).toBe(1);

		// Adding route with same operationId should fail at type level
		// @ts-expect-error - duplicate operationId
		router.add(route2);
	});

	test("isGatedRoute correctly identifies gated routes", () => {
		const gate = Gate.make(
			{},
			Effect.fn(function* () {}),
		);

		const route = Route.make(
			{ operationId: "test" },
			Effect.fn(function* () {}),
		);

		const gatedGate = gate.add(route);

		expect(Gate.isGatedRoute(gatedGate.routes[0])).toBe(true);
		expect(Gate.isGatedRoute(route)).toBe(false);
		expect(Gate.isGatedRoute(null)).toBe(false);
		expect(Gate.isGatedRoute(undefined)).toBe(false);
		expect(Gate.isGatedRoute({ _tag: "Route" })).toBe(false);
	});
});
