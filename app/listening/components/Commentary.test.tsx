import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import { Commentary } from "./Commentary";

const TEXT = "frog ate the middle of the week";

let gets = 0;
let posts: string[];

function answer(
  get: () => Response,
  post: () => Response = () => HttpResponse.json({ text: TEXT }),
) {
  server.use(
    http.get("*/api/commentary", () => {
      gets += 1;
      return get();
    }),
    http.post("*/api/commentary", ({ request }) => {
      posts.push(new URL(request.url).searchParams.get("page") ?? "");
      return post();
    }),
  );
}

const none = () => new HttpResponse(null, { status: 204 });

beforeEach(() => {
  gets = 0;
  posts = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

const take = () =>
  screen.getByText(/./, { selector: ".commentary > span:not(.face)" });

describe("Commentary", () => {
  it("should hold its pane from the first render, then show a stored comment without writing one", async () => {
    answer(() => HttpResponse.json({ text: TEXT }));
    render(<Commentary page="7day" />);

    expect(
      screen.getByRole("heading", { name: "simon-bot (take)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("paragraph")).toHaveAttribute("aria-busy", "true");

    await vi.waitFor(() => expect(take()).toHaveTextContent(TEXT));
    expect(screen.getByRole("paragraph")).toHaveAttribute("aria-busy", "false");
    expect(posts).toEqual([]);
  });

  it("should have a missing comment written after a wait, then type it out", async () => {
    answer(none);
    render(<Commentary page="2019-03-04" />);

    await vi.waitFor(() => expect(take()).toHaveTextContent("listening back"));
    expect(posts).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    await vi.waitFor(() => expect(posts).toEqual(["2019-03-04"]));
    await vi.waitFor(() =>
      expect(TEXT.startsWith(take().textContent)).toBe(true),
    );
    expect(take().textContent.length).toBeLessThan(TEXT.length);

    await vi.waitFor(() => expect(take()).toHaveTextContent(TEXT), {
      timeout: 5000,
    });
    expect(screen.getByRole("paragraph")).toHaveAttribute("aria-busy", "false");
  });

  it("should show a written comment at once with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    answer(none);
    render(<Commentary page="7day" />);

    await vi.waitFor(() => expect(take()).toHaveTextContent("listening back"));
    await act(() => vi.advanceTimersByTimeAsync(2000));

    await vi.waitFor(() => expect(take()).toHaveTextContent(TEXT));
  });

  it.each([
    ["the read fails", () => new HttpResponse(null, { status: 503 }), none],
    ["no comment comes of it", none, none],
    [
      "the write is turned away",
      none,
      () => new HttpResponse(null, { status: 429 }),
    ],
  ])("should say it has nothing when %s", async (_, get, post) => {
    answer(get, post);
    render(<Commentary page="7day" />);

    await act(() => vi.advanceTimersByTimeAsync(2000));

    await vi.waitFor(() =>
      expect(take()).toHaveTextContent("nothing to say this time"),
    );
  });

  it("should say a day still taking plays has none yet", async () => {
    answer(() => new HttpResponse(null, { status: 404 }));
    render(<Commentary page="2026-10-31" />);

    await vi.waitFor(() =>
      expect(take()).toHaveTextContent("ask me once the day is over"),
    );
    expect(posts).toEqual([]);
  });

  it("should not ask for a comment once it's gone", async () => {
    answer(none);
    const { unmount } = render(<Commentary page="2019-03-04" />);
    await vi.waitFor(() => expect(take()).toHaveTextContent("listening back"));

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(posts).toEqual([]);
  });

  it("should say today has none yet with the page, asking nothing", async () => {
    answer(none);
    await act(async () =>
      render(
        <Commentary page="2026-10-31" today={Promise.resolve("2026-10-31")} />,
      ),
    );

    expect(take()).toHaveTextContent("ask me once the day is over");
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(gets).toBe(0);
    expect(posts).toEqual([]);
  });

  it("should ask about a day before today", async () => {
    answer(() => HttpResponse.json({ text: TEXT }));
    await act(async () =>
      render(
        <Commentary page="2026-10-30" today={Promise.resolve("2026-10-31")} />,
      ),
    );

    await vi.waitFor(() => expect(take()).toHaveTextContent(TEXT));
  });

  describe("with the take the page looked up", () => {
    it("should render a stored take with the page, asking nothing", async () => {
      answer(none);
      await act(async () =>
        render(<Commentary page="7day" stored={Promise.resolve(TEXT)} />),
      );

      expect(take()).toHaveTextContent(TEXT);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(gets).toBe(0);
      expect(posts).toEqual([]);
    });

    it("should have a missing take written without asking for it first", async () => {
      answer(none);
      await act(async () =>
        render(<Commentary page="7day" stored={Promise.resolve(undefined)} />),
      );

      expect(take()).toHaveTextContent("listening back");
      await act(() => vi.advanceTimersByTimeAsync(2000));
      await vi.waitFor(() => expect(posts).toEqual(["7day"]));
      expect(gets).toBe(0);
    });

    it("should ask for it when the page couldn't look it up", async () => {
      answer(() => HttpResponse.json({ text: TEXT }));
      await act(async () =>
        render(<Commentary page="7day" stored={Promise.resolve(null)} />),
      );

      await vi.waitFor(() => expect(take()).toHaveTextContent(TEXT));
    });
  });
});
