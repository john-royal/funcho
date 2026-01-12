## Style Guide

- Files should be readable from top to bottom.
- Avoid unnecessary indirection, including prop drilling, excessive file separation, or unnecessary function extraction. **Modules should be self-contained to the greatest extent possible.**
- Prefer concise variable declarations. For example, prefer:

    ```typescript
    const thing = "thing1-thing2-thing3";
    ```

    instead of:

    ```typescript
    const thing1 = "thing1";
    const thing2 = "thing2";
    const thing3 = "thing3";
    const thing = `${thing1}-${thing2}-${thing3}`;
    ```

- **Extract functions only for complex logic or when it is reused in multiple places.** The goal is to balance conciseness with readability.
- Prefer single word variable names where possible.
- Prefer `const` over `let`.
- Avoid unnecessary destructuring of variables. Instead of doing `const { a, b } = obj`, just reference it as `obj.a` and `obj.b` to preserve context.
- Avoid `try`/`catch` where possible.
- Avoid using the `any` type, `@ts-ignore`, or `@ts-expect-error` comments unless absolutely necessary.
- **A comment is an apology.** Aim for self-documenting code, using comments sparingly when the intent is not obvious.
- Follow conventions imposed by Biome, such as preferring template literal syntax over string concatenation. Use `biome check` to enforce these conventions or `biome check --write` to automatically fix them.
- **Prefer functions and POJOs over classes** unless there is a specific reason to create a class (e.g. a Cloudflare `DurableObject` or `WorkerEntrypoint`). Effect provides alternatives (e.g. services, layers, and lifecycle management) that are more appropriate for these cases.
- **Prefer Effect over vanilla APIs unless instructed otherwise.** See the Effect Conventions section below.

## Effect Conventions

- This project uses a beta version of Effect, known as Effect 4 or `effect-smol`. Some APIs may not match what you're used to from Effect 3.
- Prefer namespace imports with deep paths. For example:

  ```typescript
  import * as Effect from "effect/Effect";
  import * as Layer from "effect/Layer";
  import * as Schema from "effect/Schema";
  import * as Stream from "effect/Stream";
  ```

  instead of:

  ```typescript
  import { Effect, Layer, Schema, Stream } from "effect";
  ```
- Define functions using `Effect.fnUntraced`. For example:
    ```typescript
    export const myFunction = Effect.fnUntraced(function* (options: Options) {
      const dep = yield* Dependency;
      // ...
      return result;
    });
    ```
- Define services using `ServiceMap.Service` with a unique, prefixed string identifier. This is similar to `Context.Tag` in Effect 3. For example:
    ```typescript
    import * as ServiceMap from "effect/ServiceMap";

    export class MyService extends ServiceMap.Service<
      MyService,
      {
        readonly doSomething: (input: Input) => Effect.Effect<Output, MyError>;
      }
    >()("@distilled/MyService") {}
    ```
- Implement services as a layer export, typically using `Layer.effect`. For example:
    ```typescript
    export const layer = Layer.effect(
      MyService,
      Effect.gen(function* () {
        // Yield dependencies
        const fs = yield* FileSystem.FileSystem;
        // Return service implementation
        return MyService.of({
          doSomething: (input) => Effect.gen(function* () {
            // Implementation
          }),
        });
      }),
    );
    ```
- Define errors using `Schema.ErrorClass`. For example:
    ```typescript
    import * as Schema from "effect/Schema";
    export class MyError extends Schema.ErrorClass("MyError")({
      _tag: Schema.tag("MyError"),
      message: Schema.String,
      // add additional fields as needed
      cause: Schema.optional(Schema.Defect),
    }) {}
    ```
- Take advantage of Effect lifecycle management features such as `Effect.acquireRelease`. For example:
    ```typescript
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        // acquire resource
      }),
      (resource) => Effect.promise(async () => {
        // release resource
      }),
    );
    ```
- Use `Effect.gen` for sequential async operations.
- For concurrent async operations, use `Effect.all` or `Effect.forEach`. Always set the `concurrency` option to `"unbounded"` unless there is a specific reason to limit the concurrency. For example:
    ```typescript
    const [result1, result2, result3] = yield* Effect.all([
      getResult1(),
      getResult2(),
      getResult3(),
    ], { concurrency: "unbounded" });
    ```

## Scripts

Scripts should be concise and prefer Bun APIs over Node.js. For example:

```typescript
import { $ } from "bun";

await $`my-command`;
const text = await Bun.file("file.txt").text();
```
instead of:

```typescript
import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";

await exec("my-command");
const text = await readFile("file.txt", "utf-8");
```

## Testing

- This project uses `vitest` and `@effect/vitest` for testing. To run tests, `cd` into the package directory and run `bun run test`. To run tests in watch mode, run `bun run test:watch`.
- Tests should be organized into files named `*.test.ts` in the `test` directory.
- Use `it.effect` for testing Effect-based code. For example:
    ```typescript
    import { assert, describe, expect, it, layer } from "@effect/vitest";
    import * as Effect from "effect/Effect";

    it.effect("test name", () => Effect.gen(function* () {
      // test code
    }));
    ```
- Where appropriate, use `describe.concurrent` to group tests. For example:
    ```typescript
    describe.concurrent("method", () => {
      it.effect("handles success case", () => Effect.gen(function* () {
        // test code
      }));
    });
    ```
    Prefer `describe.concurrent` over `describe` unless there is a specific reason to run tests sequentially.
- Use `expect` for test assertions and `assert` for type guards. For example:
    ```typescript
    import { assert, expect, it } from "@effect/vitest";
    import * as Effect from "effect/Effect";
    import * as Exit from "effect/Exit";

    // assume method() returns Effect.Effect<Result, MyError | SomeOtherError>

    it.effect("handles success case", () => Effect.gen(function* () {
      const result = yield* method();
      expect(result).toBe(expected);
    }));

    it.effect("handles error case", () => Effect.gen(function* () {
      const result = yield* Effect.exit(method()); // Exit.Exit<Result, MyError | SomeOtherError>
      assert(Exit.isFailure(result)); // now result is known to be Exit.Failure<MyError | SomeOtherError>
      assert(result.cause.failures[0]?._tag === "Fail"); // now we know that result.cause.failures[0] is a Cause.Failure<MyError | SomeOtherError> (as opposed to Cause.Die or Cause.Interrupt)
      assert(result.cause.failures[0].error instanceof MyError); // now we know the error is a MyError
      expect(result.cause.failures[0].error.message).toBe(expectedMessage); // now, FINALLY, we can check the properties of MyError. If we omitted the prior assertions, we would have a type error.
    }));
    ```
- Use `layer` to provide services to tests. For example:
    ```typescript
    import { layer } from "@effect/vitest";
    import * as Layer from "effect/Layer";
    import * as MyService from "~/services/my-service";

    layer(MyService.layer)("MyService", (it) => {
      it.effect("does something", () => Effect.gen(function* () {
        const service = yield* MyService;
        const result = yield* service.doSomething();
        expect(result).toBe(expected);
    }));
    });
    ```
    Some packages may contain helpers where the same layers are used across multiple tests.
