import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import * as Handler from "../src/Handler.js";
import * as Headers from "../src/Headers.js";
import * as Route from "../src/Route.js";
import * as Router from "../src/Router.js";

// Define test error schemas
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
	method = "POST",
): any => {
	return new globalThis.Request(`http://localhost/operation/${operationId}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body !== undefined ? JSON.stringify(body) : null,
	});
};

describe("Handler.toFetch", () => {
	test("handles minimal route with no input/output", async () => {
		const healthCheck = Route.make(
			{ operationId: "healthCheck" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(healthCheck);
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("healthCheck"));

		expect(response.status).toBe(200);
		const text = await response.text();
		// void returns undefined which JSON.stringify converts to undefined (no output)
		expect(text).toBe("");
	});

	test("handles route with input and output", async () => {
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

		const response = await handler(createRequest("greet", { name: "World" }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ message: "Hello, World!" });
	});

	test("returns 404 for unknown operation", async () => {
		const app = Router.make();
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("unknown"));

		expect(response.status).toBe(404);
		const body = (await response.json()) as {
			error: { _tag: string; operationId: string };
		};
		expect(body.error._tag).toBe("OperationNotFound");
		expect(body.error.operationId).toBe("unknown");
	});

	test("returns 405 for non-POST methods", async () => {
		const healthCheck = Route.make(
			{ operationId: "healthCheck" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(healthCheck);
		const handler = Handler.toFetch(app);

		const response = await handler(
			new Request("http://localhost/operation/healthCheck", { method: "GET" }),
		);

		expect(response.status).toBe(405);
	});

	test("returns 404 for invalid path format", async () => {
		const healthCheck = Route.make(
			{ operationId: "healthCheck" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(healthCheck);
		const handler = Handler.toFetch(app);

		const response = await handler(
			new Request("http://localhost/invalid/path", { method: "POST" }),
		);

		expect(response.status).toBe(404);
	});

	test("returns 400 for invalid JSON body", async () => {
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

		const response = await handler(
			new Request("http://localhost/operation/greet", {
				method: "POST",
				body: "not valid json{",
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { _tag: string } };
		expect(body.error._tag).toBe("InvalidJson");
	});

	test("returns 400 for invalid input schema", async () => {
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

		const response = await handler(
			createRequest("greet", { name: 123 }), // wrong type
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			error: { _tag: string; message: string };
		};
		expect(body.error._tag).toBe("ValidationError");
		expect(body.error.message).toBeDefined();
	});

	test("handles route errors", async () => {
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

		const response = await handler(createRequest("findUser", { id: "123" }));

		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			error: { _tag: string; id: string };
		};
		expect(body.error._tag).toBe("NotFoundError");
		expect(body.error.id).toBe("123");
	});

	test("handles multiple routes", async () => {
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

		const getUserResponse = await handler(
			createRequest("getUser", { id: "123" }),
		);
		expect(getUserResponse.status).toBe(200);
		const getUserBody = await getUserResponse.json();
		expect(getUserBody).toEqual({ id: "123", name: "Alice" });

		const createUserResponse = await handler(
			createRequest("createUser", { name: "Bob" }),
		);
		expect(createUserResponse.status).toBe(200);
		const createUserBody = await createUserResponse.json();
		expect(createUserBody).toEqual({ id: "new-id" });
	});

	test("response has correct Content-Type header", async () => {
		const healthCheck = Route.make(
			{ operationId: "healthCheck" },
			Effect.fn(function* () {}),
		);

		const app = Router.make().add(healthCheck);
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("healthCheck"));

		expect(response.headers.get("Content-Type")).toBe("application/json");
	});
});

describe("Headers service", () => {
	test("can read request headers", async () => {
		let capturedAuth: string | undefined;

		const checkAuth = Route.make(
			{
				operationId: "checkAuth",
				output: Schema.Struct({ authenticated: Schema.Boolean }),
			},
			Effect.fn(function* () {
				const headers = yield* Headers.Headers;
				capturedAuth = headers.get("Authorization");
				return { authenticated: capturedAuth !== undefined };
			}),
		);

		const app = Router.make().add(checkAuth);
		const handler = Handler.toFetch(app);

		const request = new Request("http://localhost/operation/checkAuth", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer secret-token",
			},
		});

		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(capturedAuth).toBe("Bearer secret-token");
		const body = await response.json();
		expect(body).toEqual({ authenticated: true });
	});

	test("can read request headers using effect accessor", async () => {
		let capturedAuth: string | undefined;

		const checkAuth = Route.make(
			{
				operationId: "checkAuth",
				output: Schema.Struct({ authenticated: Schema.Boolean }),
			},
			Effect.fn(function* () {
				capturedAuth = yield* Headers.get("Authorization");
				return { authenticated: capturedAuth !== undefined };
			}),
		);

		const app = Router.make().add(checkAuth);
		const handler = Handler.toFetch(app);

		const request = new Request("http://localhost/operation/checkAuth", {
			method: "POST",
			headers: {
				Authorization: "Bearer my-token",
			},
		});

		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(capturedAuth).toBe("Bearer my-token");
	});

	test("returns undefined for missing headers", async () => {
		let capturedAuth: string | undefined = "initial";

		const checkAuth = Route.make(
			{
				operationId: "checkAuth",
				output: Schema.Struct({ authenticated: Schema.Boolean }),
			},
			Effect.fn(function* () {
				capturedAuth = yield* Headers.get("Authorization");
				return { authenticated: capturedAuth !== undefined };
			}),
		);

		const app = Router.make().add(checkAuth);
		const handler = Handler.toFetch(app);

		const request = new Request("http://localhost/operation/checkAuth", {
			method: "POST",
		});

		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(capturedAuth).toBeUndefined();
	});

	test("can set response headers", async () => {
		const setHeaders = Route.make(
			{ operationId: "setHeaders" },
			Effect.fn(function* () {
				const headers = yield* Headers.Headers;
				headers.set("X-Custom-Header", "custom-value");
				headers.set("X-Request-Id", "req-123");
			}),
		);

		const app = Router.make().add(setHeaders);
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("setHeaders"));

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Custom-Header")).toBe("custom-value");
		expect(response.headers.get("X-Request-Id")).toBe("req-123");
		// Default Content-Type should still be present
		expect(response.headers.get("Content-Type")).toBe("application/json");
	});

	test("can set response headers using effect accessor", async () => {
		const setHeaders = Route.make(
			{ operationId: "setHeaders" },
			Effect.fn(function* () {
				yield* Headers.set("X-Custom-Header", "via-accessor");
			}),
		);

		const app = Router.make().add(setHeaders);
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("setHeaders"));

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Custom-Header")).toBe("via-accessor");
	});

	test("can append response headers", async () => {
		const setCookies = Route.make(
			{ operationId: "setCookies" },
			Effect.fn(function* () {
				yield* Headers.append("Set-Cookie", "session=abc123");
				yield* Headers.append("Set-Cookie", "theme=dark");
			}),
		);

		const app = Router.make().add(setCookies);
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("setCookies"));

		expect(response.status).toBe(200);
		// Headers.getSetCookie() returns all Set-Cookie values
		const cookies = response.headers.getSetCookie();
		expect(cookies).toContain("session=abc123");
		expect(cookies).toContain("theme=dark");
	});

	test("can read and write headers in same handler", async () => {
		const echo = Route.make(
			{
				operationId: "echo",
				output: Schema.Struct({ echoedValue: Schema.String }),
			},
			Effect.fn(function* () {
				const requestId = (yield* Headers.get("X-Request-Id")) ?? "unknown";
				yield* Headers.set("X-Response-Id", requestId);
				return { echoedValue: requestId };
			}),
		);

		const app = Router.make().add(echo);
		const handler = Handler.toFetch(app);

		const request = new Request("http://localhost/operation/echo", {
			method: "POST",
			headers: { "X-Request-Id": "req-456" },
		});

		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Response-Id")).toBe("req-456");
		const body = await response.json();
		expect(body).toEqual({ echoedValue: "req-456" });
	});

	test("response headers are included on error responses", async () => {
		const failWithHeader = Route.make(
			{
				operationId: "failWithHeader",
				errors: [NotFoundError],
			},
			Effect.fn(function* () {
				yield* Headers.set("X-Error-Code", "NOT_FOUND");
				return yield* new NotFoundError({ id: "123" });
			}),
		);

		const app = Router.make().add(failWithHeader);
		const handler = Handler.toFetch(app);

		const response = await handler(createRequest("failWithHeader"));

		expect(response.status).toBe(400);
		expect(response.headers.get("X-Error-Code")).toBe("NOT_FOUND");
	});

	test("getAll returns all request headers", async () => {
		let headerCount = 0;

		const countHeaders = Route.make(
			{
				operationId: "countHeaders",
				output: Schema.Struct({ count: Schema.Number }),
			},
			Effect.fn(function* () {
				const allHeaders = yield* Headers.getAll;
				allHeaders.forEach(() => {
					headerCount++;
				});
				return { count: headerCount };
			}),
		);

		const app = Router.make().add(countHeaders);
		const handler = Handler.toFetch(app);

		const request = new Request("http://localhost/operation/countHeaders", {
			method: "POST",
			headers: {
				"X-Header-1": "value1",
				"X-Header-2": "value2",
				"X-Header-3": "value3",
			},
		});

		await handler(request);

		expect(headerCount).toBeGreaterThanOrEqual(3);
	});
});
