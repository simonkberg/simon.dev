import {
  type RequestCookie,
  RequestCookies,
  type ResponseCookie,
  ResponseCookies,
} from "@edge-runtime/cookies";

// Next.js doesn't export ReadonlyRequestCookies, so we recreate it here
// to match the interface returned by next/headers cookies()
export type ReadonlyRequestCookies = Omit<
  RequestCookies,
  "set" | "clear" | "delete"
> &
  Pick<ResponseCookies, "set" | "delete">;

/**
 * Mock implementation of Next.js ReadonlyRequestCookies for testing.
 * Wraps @edge-runtime/cookies to provide realistic cookie handling in tests.
 *
 * @example
 * ```typescript
 * const headers = new Headers({ cookie: "session=abc123" });
 * const mockCookies = new MockCookies(headers);
 * vi.mocked(cookies).mockResolvedValue(mockCookies);
 * ```
 */
export class MockCookies implements ReadonlyRequestCookies {
  #requestCookies: RequestCookies;
  #responseCookies: ResponseCookies;

  constructor(headers: Headers) {
    this.#requestCookies = new RequestCookies(headers);
    this.#responseCookies = new ResponseCookies(headers);
  }

  [Symbol.iterator](): MapIterator<[string, RequestCookie]> {
    return this.#requestCookies[Symbol.iterator]();
  }

  get(...args: [name: string] | [RequestCookie]): RequestCookie | undefined {
    return this.#requestCookies.get(...args);
  }

  getAll(...args: [name: string] | [RequestCookie] | []): RequestCookie[] {
    return this.#requestCookies.getAll(...args);
  }

  has(name: string): boolean {
    return this.#requestCookies.has(name);
  }

  get size(): number {
    return this.#requestCookies.size;
  }

  set(
    ...args:
      | [key: string, value: string, cookie?: Partial<ResponseCookie>]
      | [options: ResponseCookie]
  ): ResponseCookies {
    return this.#responseCookies.set(...args);
  }

  delete(
    ...args:
      | [key: string]
      | [options: Omit<ResponseCookie, "value" | "expires">]
  ): ResponseCookies {
    return this.#responseCookies.delete(...args);
  }
}
