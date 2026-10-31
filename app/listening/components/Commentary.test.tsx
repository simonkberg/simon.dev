import { act, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import { Commentary } from "./Commentary";

const TEXT = "frog ate the middle of the week";

let posts: string[];

function answer(
  get: () => Response,
  post: () => Response = () => HttpResponse.json({ text: TEXT }),
) {
  server.use(
    http.get("*/api/commentary", get),
    http.post("*/api/commentary", ({ request }) => {
      posts.push(new URL(request.url).searchParams.get("page") ?? "");
      return post();
    }),
  );
}

const none = () => new HttpResponse(null, { status: 204 });

beforeEach(() => {
  posts = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

const tag = () =>
  vi.waitFor(() => screen.getByRole("button", { name: /simon-bot/ }));

describe("Commentary", () => {
  it("should keep a stored comment closed until asked", async () => {
    answer(() => HttpResponse.json({ text: TEXT }));
    render(<Commentary page="7day" />);

    expect(await tag()).toHaveTextContent("has a take");
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();

    fireEvent.click(await tag());
    expect(await tag()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(TEXT)).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it("should have a missing comment written after a wait, then type it out", async () => {
    answer(none);
    render(<Commentary page="2019-03-04" />);

    expect(await tag()).toHaveTextContent("is listening back");
    expect(await tag()).toBeDisabled();
    expect(posts).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    await vi.waitFor(() => expect(posts).toEqual(["2019-03-04"]));
    const bubble = await vi.waitFor(() => screen.getByRole("paragraph"));
    expect(bubble).toHaveAttribute("aria-busy", "true");
    expect(TEXT.startsWith(bubble.textContent)).toBe(true);
    expect(bubble.textContent.length).toBeLessThan(TEXT.length);

    await vi.waitFor(() => expect(bubble).toHaveTextContent(TEXT), {
      timeout: 5000,
    });
    expect(bubble).toHaveAttribute("aria-busy", "false");
    expect(await tag()).toHaveAttribute("aria-expanded", "true");
  });

  it("should stop typing and close when asked to", async () => {
    answer(none);
    render(<Commentary page="7day" />);
    await tag();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await vi.waitFor(() => screen.getByRole("paragraph"));

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
    expect(await tag()).toHaveTextContent("has a take");
  });

  it("should show a written comment at once with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    answer(none);
    render(<Commentary page="7day" />);

    await tag();
    await act(() => vi.advanceTimersByTimeAsync(2000));

    await vi.waitFor(() =>
      expect(screen.getByRole("paragraph")).toHaveTextContent(TEXT),
    );
  });

  it.each([
    ["the read fails", () => new HttpResponse(null, { status: 503 }), none],
    ["no comment comes of it", none, none],
    [
      "the write is turned away",
      none,
      () => new HttpResponse(null, { status: 429 }),
    ],
  ])("should show nothing when %s", async (_, get, post) => {
    answer(get, post);
    const { container } = render(<Commentary page="7day" />);

    await act(() => vi.advanceTimersByTimeAsync(2000));

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("should not ask for a comment once it's gone", async () => {
    answer(none);
    const { unmount } = render(<Commentary page="2019-03-04" />);
    await tag();

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(posts).toEqual([]);
  });
});
