import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postChatMessage } from "@/actions/chat";
import { type EmojiShortcodes, REACTION_EMOJI } from "@/lib/emoji";
import { setPreference, variantPreference } from "@/lib/preferences";
import { renderChatInput } from "@/mocks/chatInput";
import { server } from "@/mocks/node";
import { sendToggle } from "@/mocks/popover";
import { resetPreferences } from "@/mocks/preferences";

vi.mock(import("@/actions/chat"), () => ({ postChatMessage: vi.fn() }));

const EMOJI: EmojiShortcodes[] = [
  ["🧑‍🚒", ["firefighter"], []],
  ["🔥", ["fire", "flame"], []],
  ["💀", ["skull", "skeleton"], []],
  ["😀", ["grinning"], []],
  ["😃", ["smiley"], []],
];

const options = () =>
  screen
    .queryAllByRole("option")
    .map((option) => option.textContent)
    .join("");

const chosen = () => screen.queryByRole("option", { selected: true });

describe("ChatSuggestInput", () => {
  beforeEach(() => {
    server.use(http.get("*/api/emoji", () => HttpResponse.json(EMOJI)));
    vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });
  });

  afterEach(resetPreferences);

  it("offers the reactions on a bare colon, with none chosen", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "hi :");

    expect(await screen.findAllByRole("option")).toHaveLength(
      REACTION_EMOJI.length,
    );
    expect(chosen()).toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
  });

  it("filters by shortcode, and Enter inserts the first instead of sending", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "hi :fire");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(options()).toBe("🔥🧑‍🚒");
    expect(input).toHaveAttribute("aria-activedescendant", chosen()?.id);

    await user.keyboard("{Enter}");

    expect(input).toHaveValue("hi 🔥 ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(postChatMessage).not.toHaveBeenCalled();
  });

  it("suggests and inserts emoji in the picked skin tone", async () => {
    localStorage.setItem("skin-tone", "2");
    const { user, input } = renderChatInput();

    await user.type(input, ":fire");
    await screen.findByRole("listbox");
    expect(options()).toBe("🔥🧑🏼‍🚒");
    await user.keyboard("{ArrowRight}{Enter}");

    expect(input).toHaveValue("🧑🏼‍🚒 ");
  });

  it("moves the choice with the arrow keys and picks it with Tab", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":fire");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowRight}");
    expect(chosen()).toHaveAccessibleName("firefighter");
    await user.keyboard("{ArrowLeft}{ArrowRight}{Tab}");

    expect(input).toHaveValue("🧑‍🚒 ");
    expect(input).toHaveFocus();
  });

  it("replaces only the shortcode at the caret", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":sk later");
    await user.keyboard("{ArrowLeft>6/}");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");

    expect(input).toHaveValue("💀 later");
  });

  it("sends a short emoticon like :S unless an emoji is chosen", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":S");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(chosen()).toBeNull();
    await user.keyboard("{Enter}");

    expect(postChatMessage).toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("forgets a dismissal once the message is sent", async () => {
    const { promise, resolve } = Promise.withResolvers<{ status: "ok" }>();
    vi.mocked(postChatMessage).mockReturnValue(promise);
    const { user, input } = renderChatInput();

    await user.type(input, "hi :S");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}{Enter}");
    resolve({ status: "ok" });
    await waitFor(() => expect(input).toHaveValue(""));
    await user.paste("hi :S");

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  it("loads the emoji when a shortcode is typed into an input focused before hydration", async () => {
    const { input } = renderChatInput();

    fireEvent.change(input, { target: { value: ":fire" } });

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  it("chooses the first with an up or down arrow when none is", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":s");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowUp}{Enter}");

    expect(input).toHaveValue("💀 ");
  });

  it("closes on Escape without clearing the reply, until the shortcode changes", async () => {
    const { user, input, setReplyToId } = renderChatInput("message-id");

    await user.type(input, ":sk");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(setReplyToId).not.toHaveBeenCalled();

    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  it("keeps the choice within the list at its ends, leaving Home and End to the caret", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":fire");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowUp}{ArrowLeft}{End}");
    expect(chosen()).toHaveAccessibleName("fire");
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");

    expect(chosen()).toHaveAccessibleName("firefighter");
  });

  it("leaves keys to an input method mid-composition", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":fire");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(input).toHaveValue(":fire");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes when the browser dismisses it, as on a click outside", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":fire");
    const picker = await screen.findByRole("listbox");
    sendToggle(picker, "toggle", "open");
    expect(picker).toBeInTheDocument();
    sendToggle(picker, "toggle", "closed");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes when focus moves on", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":S");
    await screen.findByRole("listbox");
    await user.tab();

    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stays open when a tap takes focus without a new target", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":fire");
    await screen.findByRole("listbox");
    fireEvent.blur(input, { relatedTarget: null });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("inserts a clicked emoji and keeps focus in the input", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "so :s");
    await user.click(await screen.findByRole("option", { name: "skull" }));

    expect(input).toHaveValue("so 💀 ");
    expect(input).toHaveFocus();
  });

  it("closes when a shortcode is selected rather than typed up to", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "hi :fire");
    await screen.findByRole("listbox");
    input.setSelectionRange(4, 8);
    fireEvent.select(input);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ignores a pick once the caret has left the shortcode", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "hi :fire");
    const option = await screen.findByRole("option", { name: "fire" });
    input.setSelectionRange(0, 0);
    fireEvent.click(option);

    expect(input).toHaveValue("hi :fire");
  });

  it("names the chosen emoji under the list", async () => {
    const { user, input } = renderChatInput();
    const name = () => document.querySelector(".emoji-picker > .name");

    await user.type(input, ":f");
    await screen.findByRole("listbox");
    expect(name()).toBeEmptyDOMElement();

    await user.type(input, "i");
    expect(name()).toHaveTextContent(":firefighter:");
    await user.keyboard("{ArrowRight}");
    expect(name()).toHaveTextContent(":fire:");
  });

  it("shows each emoji's shortcode as its tooltip", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, ":skel");

    expect(
      await screen.findByRole("option", { name: "skeleton" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
      ":skeleton:",
    );
  });

  it("offers commands after a leading slash, then their options", async () => {
    setPreference(variantPreference, "manual");
    const { user, input } = renderChatInput();

    await user.type(input, "/");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    expect(chosen()).toHaveTextContent("/help");
    await user.type(input, "s{Enter}");

    expect(input).toHaveValue("/style ");
    expect(options()).toBe("panesledgermanualcurrent");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveValue("/style ledger ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(postChatMessage).not.toHaveBeenCalled();
  });

  it("chooses nothing for a command typed in full, so Enter runs it", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "/help");

    expect(screen.getByRole("listbox")).toBeVisible();
    expect(chosen()).toBeNull();
  });

  it("suggests emoji after a command that takes no options", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "/help :fire");

    expect(await screen.findByRole("listbox", { name: "Emoji" })).toBeVisible();
  });

  it.each([
    "12:30",
    "https://simon.dev",
    ":)",
    ":zzz",
    "hi /help",
    "//",
    "/style ledger x",
  ])("stays closed for %s", async (text) => {
    const { user, input } = renderChatInput();

    await user.type(input, text);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});
