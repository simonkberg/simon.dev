// Static stand-ins for the chat's client behaviour, so its states can be reviewed.
(() => {
  const idle = [
    "(-_-)zzz",
    "(-_-)Zzz",
    "(-_-)zZz",
    "(-_-)zzZ",
    "(-_-)zzz",
    "(-_-)...",
    "(-o-)...",
    "(-O-)...",
    "(-o-)...",
    "(-_-)...",
  ];
  const typing = ["(°▽°)", "(°ᴗ°)", "(°▽°)", "(°_°)"];
  const code = ["(⌐■_■)", "(■_■⌐)"];
  const buddy = document.querySelector(".caret-buddy");
  const input = document.querySelector(".chat-input .input");
  const form = document.querySelector(".chat-input");
  let lastInput = 0;
  let frame = 0;

  if (buddy && input) {
    setInterval(() => {
      const frames = input.value.includes("`")
        ? code
        : Date.now() - lastInput < 3000
          ? typing
          : idle;
      frame = (frame + 1) % frames.length;
      buddy.textContent = frames[frame];
    }, 450);
    input.addEventListener("input", () => (lastInput = Date.now()));
  }

  const scrollable = document.querySelector(".chat-history .scrollable");
  let replyingTo = null;

  const clearReply = () => {
    replyingTo?.querySelector(".reply")?.removeAttribute("disabled");
    replyingTo = null;
    document.querySelector(".chat-replying-to")?.remove();
    if (input) input.placeholder = "Write a message...";
  };

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.matches(".chat-message .reply")) {
      clearReply();
      replyingTo = target.closest(".chat-message");
      target.disabled = true;
      const box = document.createElement("div");
      box.className = "chat-replying-to";
      box.setAttribute("role", "status");
      box.innerHTML = '<small class="subtitle">Replying to</small>';
      const copy = replyingTo.cloneNode(true);
      copy.querySelector(".reply").disabled = true;
      box.append(copy);
      const clear = document.createElement("button");
      clear.className = "clear";
      clear.setAttribute("aria-label", "Clear reply");
      clear.innerHTML = "&times;";
      box.append(clear);
      form.before(box);
      input.placeholder = "Write a reply...";
      input.focus();
    } else if (target.matches(".chat-replying-to .clear")) {
      clearReply();
    } else if (target.matches(".chat-tip .clear")) {
      target.closest(".chat-tip").remove();
    } else if (target.matches(".control.maximize")) {
      const terminal = target.closest(".terminal");
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void terminal.requestFullscreen?.().catch(() => {});
    } else if (target.matches(".chat-toast button")) {
      target.closest(".chat-toast").remove();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearReply();
  });

  const toast = (message, variant) => {
    document.querySelector(".chat-toast")?.remove();
    const el = document.createElement("div");
    el.className = `chat-toast ${variant}`;
    el.setAttribute("role", "status");
    el.innerHTML = `<span></span><button type="button" aria-label="Close notification">&times;</button>`;
    el.firstChild.textContent = message;
    form.before(el);
    setTimeout(() => el.remove(), 5000);
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (text === "/error") {
      toast("Failed to send message, try again later.", "error");
      return;
    }
    const li = document.createElement("li");
    li.innerHTML =
      '<div class="chat-message" style="--user-color: hsl(200 95% 65%)"><span class="user">curious-otter: </span>' +
      '<div class="text"></div> <small class="timestamp">now</small> <button aria-label="Reply" title="Reply" class="reply">↩</button></div>';
    li.querySelector(".text").textContent = text;
    const parent = replyingTo?.parentElement;
    if (parent) {
      let list = parent.querySelector(":scope > ul");
      if (!list) parent.append((list = document.createElement("ul")));
      list.append(li);
    } else {
      document.querySelector(".chat-history ul.content").append(li);
    }
    input.value = "";
    clearReply();
    scrollable?.scrollTo({ top: scrollable.scrollHeight });
  });

  // Theme switch for the standalone pages; the viewer drives it from outside.
  if (window.top === window) {
    const modes = ["system", "light", "dark"];
    const button = document.createElement("button");
    button.type = "button";
    button.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:9;font:12px/1 ui-monospace,monospace;padding:6px 8px;" +
      "background:#000;color:#fff;border:1px solid #666;border-radius:4px;opacity:.7;cursor:pointer";
    let mode = 0;
    const apply = () => {
      button.textContent = `theme: ${modes[mode]}`;
      if (mode === 0) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.dataset.theme = modes[mode];
    };
    button.addEventListener("click", () => {
      mode = (mode + 1) % modes.length;
      apply();
    });
    apply();
    document.body.append(button);
  }
})();
