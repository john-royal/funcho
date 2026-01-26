import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import * as Client from "../src/Client.js";
import * as Gate from "../src/Gate.js";
import * as Handler from "../src/Handler.js";
import * as Route from "../src/Route.js";
import * as Router from "../src/Router.js";

// Define test error schemas
class NotFoundError extends Schema.TaggedError<NotFoundError>()(
	"NotFoundError",
	{
		id: Schema.String,
	},
) {}

class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	{
		message: Schema.String,
	},
) {}

describe("Client.make", () => {
	test("calls correct endpoint with operationId", async () => {
		const fetchMock = mock<Client.Fetcher>(async () =>
			Response.json({ message: "Hello, World!" }),
		);

		const greet = Route.make(
			{
				operationId: "greet",
				input: Schema.Struct({ name: Schema.String }),
				output: Schema.Struct({ message: Schema.String }),
			},
			Effect.fn(function* ({ name }) {
				return { message: `Hello, ${name}!` };
			}),
		);

		const app = Router.make().add(greet);
		type App = typeof app;

		const client = Client.make<App>({
			baseUrl: "http://localhost",
			fetch: fetchMock,
		});

		await client.greet({ name: "World" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0]!;
		expect(url).toBe("http://localhost/operation/greet");
		expect(options?.method).toBe("POST");
		expect(options?.body).toBe(JSON.stringify({ name: "World" }));
	});

	test("returns ok: true with value on success", async () => {
		const greet = Route.make(
			{
				operationId: "greet",
				input: Schema.Struct({ name: Schema.String }),
				output: Schema.Struct({ message: Schema.String }),
			},
			Effect.fn(function* ({ name }) {
				return { message: `Hello, ${name}!` };
			}),
		);

		const app = Router.make().add(greet);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const result = await client.greet({ name: "World" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ message: "Hello, World!" });
		}
	});

	test("returns ok: false with error on failure", async () => {
		const findUser = Route.make(
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

		const app = Router.make().add(findUser);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const result = await client.findUser({ id: "123" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("NotFoundError");
			expect(result.error.id).toBe("123");
		}
	});

	test("handles routes with no input", async () => {
		const healthCheck = Route.make(
			{
				operationId: "healthCheck",
				output: Schema.Struct({ status: Schema.String }),
			},
			Effect.fn(function* () {
				return { status: "ok" };
			}),
		);

		const app = Router.make().add(healthCheck);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const result = await client.healthCheck();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ status: "ok" });
		}
	});

	test("handles routes with void output", async () => {
		const ping = Route.make(
			{ operationId: "ping" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(ping);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const result = await client.ping();

		expect(result.ok).toBe(true);
	});

	test("includes default headers in requests", async () => {
		const fetchMock = mock<Client.Fetcher>(async () => Response.json({}));

		const ping = Route.make(
			{ operationId: "ping" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(ping);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			headers: {
				Authorization: "Bearer token123",
				"X-Custom": "custom-value",
			},
			fetch: fetchMock,
		});

		await client.ping();

		const [, options] = fetchMock.mock.calls[0]!;
		const headers = options?.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer token123");
		expect(headers["X-Custom"]).toBe("custom-value");
		expect(headers["Content-Type"]).toBe("application/json");
	});

	test("normalizes baseUrl by removing trailing slash", async () => {
		const fetchMock = mock<Client.Fetcher>(async () => Response.json({}));

		const ping = Route.make(
			{ operationId: "ping" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(ping);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost/",
			fetch: fetchMock,
		});

		await client.ping();

		const [url] = fetchMock.mock.calls[0]!;
		expect(url).toBe("http://localhost/operation/ping");
	});

	test("works with multiple routes", async () => {
		const getUser = Route.make(
			{
				operationId: "getUser",
				input: Schema.Struct({ id: Schema.String }),
				output: Schema.Struct({ id: Schema.String, name: Schema.String }),
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
			},
			Effect.fn(function* () {
				return { id: "new-id" };
			}),
		);

		const app = Router.make().add(getUser).add(createUser);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const userResult = await client.getUser({ id: "123" });
		expect(userResult.ok).toBe(true);
		if (userResult.ok) {
			expect(userResult.value).toEqual({ id: "123", name: "Alice" });
		}

		const createResult = await client.createUser({ name: "Bob" });
		expect(createResult.ok).toBe(true);
		if (createResult.ok) {
			expect(createResult.value).toEqual({ id: "new-id" });
		}
	});

	test("works with gated routes", async () => {
		const AuthGate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* () {
				// Simulate auth success
				return { userId: "user-123" };
			}),
		);

		const getProfile = Route.make(
			{
				operationId: "getProfile",
				output: Schema.Struct({ name: Schema.String }),
			},
			Effect.fn(function* () {
				const { userId } = yield* AuthGate.Context;
				return { name: `User ${userId}` };
			}),
		);

		const protectedRoutes = AuthGate.add(getProfile);
		const app = Router.make().add(protectedRoutes);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const result = await client.getProfile();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ name: "User user-123" });
		}
	});

	test("handles gated route errors", async () => {
		const AuthGate = Gate.make(
			{ errors: [UnauthorizedError] },
			Effect.fn(function* (): Effect.fn.Return<
				{ userId: string },
				UnauthorizedError
			> {
				return yield* new UnauthorizedError({ message: "Invalid token" });
			}),
		);

		const getProfile = Route.make(
			{
				operationId: "getProfile",
				output: Schema.Struct({ name: Schema.String }),
			},
			Effect.fn(function* () {
				const { userId } = yield* AuthGate.Context;
				return { name: `User ${userId}` };
			}),
		);

		const protectedRoutes = AuthGate.add(getProfile);
		const app = Router.make().add(protectedRoutes);
		const handler = Handler.toFetch(app);

		const client = Client.make<typeof app>({
			baseUrl: "http://localhost",
			fetch: (url, options) => handler(new Request(url, options)),
		});

		const result = await client.getProfile();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("UnauthorizedError");
			expect(result.error.message).toBe("Invalid token");
		}
	});
});
