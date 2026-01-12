export const ResponseBodySymbol: unique symbol = Symbol.for(
  "funcho/ResponseBody",
);

export interface ResponseOptions {
  readonly headers?: Record<string, string>;
  readonly statusText?: string;
}

export interface ResponseBodyOutput {
  readonly body: string | ReadableStream | ArrayBuffer | Uint8Array | null;
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
}

export interface ResponseBody {
  readonly [ResponseBodySymbol]: true;
  toResponse(): ResponseBodyOutput;
}

export const isResponseBody = (value: unknown): value is ResponseBody =>
  value !== null &&
  typeof value === "object" &&
  ResponseBodySymbol in value &&
  value[ResponseBodySymbol] === true;

export class FunchoResponse<T> implements ResponseBody {
  readonly [ResponseBodySymbol] = true as const;

  constructor(
    readonly data: T,
    readonly status: number,
    readonly options: ResponseOptions = {},
  ) {}

  toResponse(): ResponseBodyOutput {
    const body =
      this.data === undefined || this.data === null
        ? null
        : this.data instanceof ReadableStream
          ? this.data
          : JSON.stringify(this.data);
    return {
      body,
      status: this.status,
      statusText: this.options.statusText,
      headers: this.options.headers,
    };
  }
}

export const Respond = {
  ok: <T>(data: T, options?: ResponseOptions): FunchoResponse<T> =>
    new FunchoResponse(data, 200, options),

  created: <T>(data: T, options?: ResponseOptions): FunchoResponse<T> =>
    new FunchoResponse(data, 201, options),

  accepted: <T>(data: T, options?: ResponseOptions): FunchoResponse<T> =>
    new FunchoResponse(data, 202, options),

  noContent: (options?: ResponseOptions): FunchoResponse<undefined> =>
    new FunchoResponse(undefined, 204, options),

  custom: <T>(
    data: T,
    status: number,
    options?: ResponseOptions,
  ): FunchoResponse<T> => new FunchoResponse(data, status, options),
};
