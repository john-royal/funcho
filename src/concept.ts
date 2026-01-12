import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as ServiceMap from "effect/ServiceMap";

declare type Implementation<Contract> = {};
declare function defineContract<Contract>(
  contract: Contract,
): ServiceMap.Service<Implementation<Contract>, Implementation<Contract>> & {
  Contract: Contract;
};
declare const FetchHandler: {
  from<Contract>(
    contract: Contract,
  ): Effect.Effect<
    (request: Request) => Promise<Response>,
    never,
    Implementation<Contract>
  >;
};

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
});
type User = typeof User.Type;

const pick = <
  S extends Schema.Struct<Schema.Struct.Fields>,
  Picked extends ReadonlyArray<keyof S["fields"]>,
>(
  schema: S,
  picked: Picked,
): Schema.Struct<{ [K in Picked[number]]: S["fields"][K] }> => {
  return schema.mapFields((fields) =>
    // @ts-expect-error - TODO: fix this
    Object.fromEntries(picked.map((field) => [field, fields[field]])),
  );
};

declare module "effect/Schema" {
  namespace Annotations {
    interface Bottom<
      T,
      TypeParameters extends ReadonlyArray<Top> = readonly [],
    > {
      httpStatus?: number;
    }
  }
}

class NotFoundError extends Schema.ErrorClass<NotFoundError>("NotFoundError")(
  {
    message: Schema.String,
  },
  {
    httpStatus: 404,
  },
) {}

class EmailAlreadyExistsError extends Schema.ErrorClass<EmailAlreadyExistsError>(
  "EmailAlreadyExistsError",
)(
  {
    message: Schema.String,
  },
  {
    httpStatus: 409,
  },
) {}

const Contract = defineContract({
  "/users": {
    get: {
      description: "List all users",
      query: {
        offset: Schema.optional(Schema.Number),
        limit: Schema.optional(Schema.Number),
      },
      success: Schema.Struct({
        users: Schema.Array(User),
        total: Schema.Number,
        page: Schema.Number,
        limit: Schema.Number,
      }),
      failure: NotFoundError,
    },
    post: {
      description: "Create a new user",
      body: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
      }),
      success: User.pipe(Schema.annotate({ httpStatus: 201 })),
      failure: EmailAlreadyExistsError,
    },
  },
  "/users/{id}": {
    get: {
      description: "Get a user by ID",
      path: {
        id: Schema.Number,
      },
      success: User,
      failure: NotFoundError,
    },
    put: {
      description: "Update a user by ID",
      body: pick(User, ["name", "email"]),
      success: User,
      failure: Schema.Union([NotFoundError, EmailAlreadyExistsError]),
    },
    delete: {
      description: "Delete a user by ID",
      path: {
        id: Schema.Number,
      },
      success: Schema.Void,
      failure: NotFoundError,
    },
  },
});
type Contract = typeof Contract.Contract;

const ContractImpl = Layer.sync(Contract, () => {
  const users: User[] = [];
  return {
    "/users": {
      get: (ctx: { query: { offset?: number; limit?: number } }) =>
        Effect.succeed({
          users,
          total: users.length,
          page: 1,
          limit: 10,
        }),
      post: (ctx: { body: { name: string; email: string } }) =>
        Effect.gen(function* () {
          const id = users.length + 1;
          const user: User = {
            id,
            name: ctx.body.name,
            email: ctx.body.email,
          };
          users.push(user);
          return yield* Effect.succeed(user);
        }),
    },
    "/users/{id}": {
      get: (ctx: { params: { id: number } }) =>
        Effect.gen(function* () {
          const user = users.find((user) => user.id === ctx.params.id);
          if (!user) {
            return yield* new NotFoundError({ message: "User not found" });
          }
          return user;
        }),
      put: (ctx: {
        params: { id: number };
        body: Pick<User, "name" | "email">;
      }) =>
        Effect.gen(function* () {
          const userIndex = users.findIndex(
            (user) => user.id === ctx.params.id,
          );
          if (userIndex === -1) {
            return yield* new NotFoundError({ message: "User not found" });
          }
          const emailIndex = users.findIndex(
            (user) => user.email === ctx.body.email,
          );
          if (emailIndex !== -1 && emailIndex !== userIndex) {
            return yield* new EmailAlreadyExistsError({
              message: "Email already exists",
            });
          }
          const user = {
            id: ctx.params.id,
            name: ctx.body.name,
            email: ctx.body.email,
          };
          users[userIndex] = user;
          return user;
        }),
      delete: (ctx: { params: { id: number } }) =>
        Effect.gen(function* () {
          const userIndex = users.findIndex(
            (user) => user.id === ctx.params.id,
          );
          if (userIndex === -1) {
            return yield* new NotFoundError({ message: "User not found" });
          }
          users.splice(userIndex, 1);
        }),
    },
  } as Implementation<Contract>;
});

const program = FetchHandler.from(Contract).pipe(Effect.provide(ContractImpl));
