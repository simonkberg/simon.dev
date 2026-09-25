"""Builds the static redesign concepts from the site's real markup and content.

    python3 design-concepts/build.py            # writes <concept>/*.html, then oxfmt
    python3 design-concepts/build.py --viewer out.html
                                                # also a single-file viewer with
                                                # subset fonts inlined (needs fonttools + brotli)
"""

import base64
import html
import io
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
ASSETS = ROOT.parent / "app" / "assets"

CONCEPTS = {
    "manual": "Manual",
    "ledger": "Ledger",
    "panes": "Panes",
}

PAGES = {
    "index": ("Simon Kjellberg", None),
    "listening": ("Listening - all time - Simon Kjellberg", "Listening"),
    "not-found": ("Not Found - Simon Kjellberg", "Not Found"),
    "error": ("Error - Simon Kjellberg", "Error"),
}

DESCRIPTION = (
    "Fullstack engineer, specialized in React, Node.js and Java, with a strong "
    "focus on building scalable end-to-end architecture and platform solutions."
)

STATS = [
    ("Markdown", 47.09), ("Other", 30.77), ("JavaScript", 4.84),
    ("TypeScript", 3.64), ("Java", 3.20), ("XML", 2.57), ("Bash", 2.34),
    ("Python", 1.85), ("YAML", 1.80), ("JSON", 1.00), ("Text", 0.53),
    ("TOML", 0.15), ("SQL", 0.15), ("Protocol Buffer", 0.08),
]

RECENT = [
    ("Get Disowned", "Hop Along", None, False),
    ("It's Too Late", "Asobi Seksu", "10 hours ago", True),
    ("Erica Western Teleport", "Emperor X", "10 hours ago", False),
    ("Cool and Refreshing", "Florist", "10 hours ago", False),
    ("Slower Now", "Star Horse", "10 hours ago", False),
]

TOP_TRACKS = [
    ("Thursday", "Asobi Seksu", 164), ("Your Ex-Lover Is Dead", "Stars", 147),
    ("Overcoat", "Honeybreath", 144), ("Goodbye", "Asobi Seksu", 130),
    ("Queen of the Surface Streets", "DeVotchKa", 129),
    ("Take Me to the Riot", "Stars", 125), ("My Favourite Book", "Stars", 119),
    ("Yesterday, Never", "Clap Your Hands Say Yeah", 118),
    ("Celebration Guns", "Stars", 118),
    ("Take Ecstasy With Me", "The Magnetic Fields", 115),
]

TOP_ARTISTS = [
    ("Stars", 3038), ("The Magnetic Fields", 2714), ("The National", 1899),
    ("Clap Your Hands Say Yeah", 1880), ("of Montreal", 1687),
    ("Sufjan Stevens", 1488), ("The Radio Dept.", 1413), ("Asobi Seksu", 1290),
    ("Belle & Sebastian", 1133), ("Björn Kleinhenz", 1110),
]

TOP_ALBUMS = [
    ("In Our Bedroom After the War", "Stars", 788),
    ("69 Love Songs", "The Magnetic Fields", 670), ("Citrus", "Asobi Seksu", 614),
    ("Clap Your Hands Say Yeah", "Clap Your Hands Say Yeah", 595),
    ("The Five Ghosts", "Stars", 496),
    ("Hysterical", "Clap Your Hands Say Yeah", 469),
    ("Lesser Matters", "The Radio Dept.", 441), ("Alligator", "The National", 426),
    ("In the Aeroplane Over the Sea", "Neutral Milk Hotel", 407),
    ("Writer's Block", "Peter Bjorn and John", 364),
]

# (user, content html, timestamp, edited, replies)
CHAT = [
    ("loving-jackal", "hello", "4mo ago", False, []),
    ("loving-jackal", "@simon-bot i mean technically, what stack do you use?", "4mo ago", False, [
        ("simon",
         "thanks! it’s a next.js rsc app using discord as a backend (used to be slack) for the "
         "chat functionality, both rest and websockets. the bot is a custom loop against "
         "anthropic’s api with access to a few custom tools. the source code is here: "
         '<a href="https://github.com/simonkberg/simon.dev">https://github.com/simonkberg/simon.dev</a>',
         "4mo ago", False, [
             ("simon-bot",
              "nice stack - rsc + discord combo is a pretty clean move, and rolling your own "
              "anthropic integration beats sdk bloat every time",
              "4mo ago", False, []),
         ]),
    ]),
    ("helpful-sandpiper", "Hi Simon, greeting from Bolivia!", "3mo ago", False, [
        ("simon", "hi!", "3mo ago", False, []),
    ]),
    ("resourceful-coyote", "I love Simon ❤️", "3mo ago", False, [
        ("simon", "lol thanks", "3mo ago", True, []),
    ]),
    ("bright-mammoth", "how do i run this thing locally?", "19d ago", False, [
        ("simon", "<code>pnpm dev</code>, but you’ll need your own discord bot token", "19d ago", False, []),
    ]),
    ("impartial-toad", "perlin noise sucks", "13d ago", False, [
        ("simon", "what did perlin noise ever do to you?", "6d ago", False, []),
    ]),
    ("romantic-oyster", "b", "2d ago", False, [("simon", "🅱️", "2d ago", False, [])]),
    ("romantic-oyster", "actually its pronounced b", "2d ago", False, []),
]


def djb2hash(s: str) -> int:
    def int32(n: int) -> int:
        n &= 0xFFFFFFFF
        return n - 0x100000000 if n & 0x80000000 else n

    a = 5381
    for ch in s:
        a = int32((int32(a << 5) + a) ^ ord(ch))
    return a


def string_to_color(s: str) -> str:
    # JS `%` keeps the sign of the dividend.
    h = djb2hash(s)
    hue = abs(h) % 360 * (-1 if h < 0 else 1)
    return f"hsl({hue} 95% 65%)"


e = html.escape


# --- shared markup, mirroring the React components -------------------------


def heading(text, subtitle=None, id=None):
    sub = f" <small class=\"subtitle\">{subtitle}</small>" if subtitle else ""
    ida = f' id="{id}"' if id else ""
    return f'<h2{ida} class="heading">{text}{sub}</h2>'


def ext(href, label):
    return f'<a href="{href}" target="_blank" rel="noopener noreferrer">{label}</a>'


def stats_list():
    top = STATS[0][1]
    items = "".join(
        f'<li style="--value: {v}"><span class="label">{e(n)}</span> '
        f'<span class="value">{v:.2f}%</span></li>'
        for n, v in STATS
    )
    return f'<ul class="stats" style="--max: {top}">{items}</ul>'


def recent_tracks():
    out = []
    for name, artist, played, loved in RECENT:
        heart = " ❤ " if loved else ""
        sub = (
            f'<small class="subtitle">({played})</small>'
            if played
            else '<small class="subtitle now-playing">(Now playing)</small>'
        )
        out.append(f"<li>{e(name)} &ndash; <em>{e(artist)}</em> {heart}{sub}</li>")
    return f'<ul class="recent-tracks">{"".join(out)}</ul>'


def chat_messages(messages):
    out = []
    for user, content, ts, edited, replies in messages:
        edited_html = '<small class="edited"> (edited) </small>' if edited else ""
        nested = f"<ul>{chat_messages(replies)}</ul>" if replies else ""
        out.append(
            f'<li><div class="chat-message" style="--user-color: {string_to_color(user)}">'
            f'<span class="user">{e(user)}: </span>'
            f'<div class="text">{content}</div>{edited_html} '
            f'<small class="timestamp">{ts}</small> '
            f'<button aria-label="Reply" title="Reply" class="reply">↩</button>'
            f"</div>{nested}</li>"
        )
    return "".join(out)


def terminal():
    return (
        '<div class="terminal" role="region" aria-label="Terminal">'
        '<div class="topbar">'
        '<button class="control close" aria-label="Close"></button>'
        '<button class="control minimize" aria-label="Minimize"></button>'
        '<button class="control maximize" aria-label="Maximize"></button>'
        "</div>"
        '<div class="content">'
        '<div class="chat-history"><div class="scrollable"><ul class="content">'
        f"{chat_messages(CHAT)}"
        "</ul></div></div>"
        '<form class="chat-input"><div class="wrapper">'
        '<input name="text" placeholder="Write a message..." class="input" autocomplete="off">'
        '<span class="caret-buddy" aria-hidden="true">(-_-)zzz</span>'
        "</div>"
        '<p class="chat-tip"><span aria-hidden="true">&#x24D8;</span> mention &ldquo;simon bot&rdquo; '
        "to chat with a clanker. "
        '<button type="button" aria-label="Dismiss tip" title="Dismiss tip" class="clear">&times;</button>'
        "</p></form>"
        "</div></div>"
    )


def home_body():
    return f"""
<section aria-labelledby="about-heading">
  {heading("About", "(Location: Stockholm, Sweden)", "about-heading")}
  <p>{DESCRIPTION}</p>
  <p>Working as a senior engineer at {ext("https://twitter.com/SpotifyEng", "Spotify")}.</p>
</section>
<section aria-labelledby="writing-heading">
  {heading("Currently writing", f'(Via {ext("https://wakatime.com/@simonkberg", "WakaTime")})', "writing-heading")}
  {stats_list()}
</section>
<section aria-labelledby="listening-heading">
  {heading("Currently listening to", f'(Via {ext("https://www.last.fm/user/magijo", "Last.fm")})', "listening-heading")}
  {recent_tracks()}
  <p>See <a href="listening.html">listening statistics</a>.</p>
</section>
<section aria-labelledby="links-heading">
  {heading("Links", None, "links-heading")}
  <ul class="links">
    <li>{ext("https://github.com/simonkberg", "GitHub")}</li>
    <li>{ext("https://linkedin.com/in/simonkjellberg", "LinkedIn")}</li>
  </ul>
</section>
<section aria-labelledby="chat-heading">
  {heading("Chat", None, "chat-heading")}
  {terminal()}
</section>
"""


def table(kind, rows):
    if kind == "artists":
        cols = '<col><col style="width: 100%"><col>'
        head = '<th class="numeric">#</th><th>Artist</th><th class="numeric">Plays</th>'
        body = "".join(
            f'<tr><td class="numeric">{i}</td><td>{e(a)}</td><td class="numeric">{p}</td></tr>'
            for i, (a, p) in enumerate(rows, 1)
        )
    else:
        label = "Track" if kind == "tracks" else "Album"
        cols = '<col><col style="width: 50%"><col style="width: 50%"><col>'
        head = (
            f'<th class="numeric">#</th><th>{label}</th><th>Artist</th>'
            '<th class="numeric">Plays</th>'
        )
        body = "".join(
            f'<tr><td class="numeric">{i}</td><td>{e(n)}</td><td>{e(a)}</td>'
            f'<td class="numeric">{p}</td></tr>'
            for i, (n, a, p) in enumerate(rows, 1)
        )
    return (
        f"<table><colgroup>{cols}</colgroup><thead><tr>{head}</tr></thead>"
        f"<tbody>{body}</tbody></table>"
    )


def listening_body():
    periods = ["7 days", "1 month", "3 months", "6 months", "1 year"]
    menu = "".join(f'<li><a href="listening.html">{p}</a></li>' for p in periods)
    menu += '<li aria-current="page">all time</li>'
    return f"""
<section>
  <p>My all time listening statistics from {ext("https://www.last.fm/user/magijo", "Last.fm")}.</p>
</section>
<menu>{menu}</menu>
<section>
  {heading("Top Tracks", "(Top 10)")}
  {table("tracks", TOP_TRACKS)}
</section>
<section>
  {heading("Top Artists", "(Top 10)")}
  {table("artists", TOP_ARTISTS)}
</section>
<section>
  {heading("Top Albums", "(Top 10)")}
  {table("albums", TOP_ALBUMS)}
</section>
"""


def not_found_body():
    return f"""
<section>
  {heading("Page not found!")}
  <p>The page you are looking for does not exist.</p>
</section>
"""


def error_body():
    return f"""
<section>
  {heading("Something went wrong!")}
  <p class="subtitle">Failed to fetch recent tracks: 503 Service Unavailable</p>
  <button class="link">Try again</button>
</section>
"""


BODIES = {
    "index": home_body,
    "listening": listening_body,
    "not-found": not_found_body,
    "error": error_body,
}

RAILWAY = (
    f'Hosted on {ext("https://railway.com?referralCode=wzuAxn", "Railway")} (affiliate link).'
)


# --- per-concept chrome ----------------------------------------------------


def header_manual(section):
    center = section or "simon.dev"
    return f"""
<header class="header"><div class="container">
  <h1 class="title"><a href="index.html" class="link">simon-kjellberg(1)</a></h1>
  <span class="center">{center}</span>
  <span class="right" aria-hidden="true">simon-kjellberg(1)</span>
</div></header>"""


def footer_manual(page):
    railway = f'<p class="subtitle">{RAILWAY}</p>' if page == "index" else ""
    return f"""
<footer class="footer">{railway}
  <div class="colophon"><span>simon.dev</span><span>September 2026</span><span aria-hidden="true">simon-kjellberg(1)</span></div>
</footer>"""


def header_ledger(section):
    path = f'<span class="path">/{section.lower().replace(" ", "-")}</span>' if section else ""
    return f"""
<header class="header"><div class="container">
  <h1 class="title"><a href="index.html" class="link"><span class="shebang">#!/</span>simon kjellberg</a>{path}</h1>
</div></header>"""


def footer_ledger(page):
    return f'<footer class="footer"><small class="subtitle">{RAILWAY}</small></footer>' if page == "index" else ""


def header_panes(section):
    home = ' aria-current="page"' if section is None else ""
    listening = ' aria-current="page"' if section == "Listening" else ""
    return f"""
<header class="header"><div class="container">
  <h1 class="title"><a href="index.html" class="link">simon kjellberg</a></h1>
  <nav class="windows" aria-label="Pages">
    <a href="index.html"{home}>0:home</a>
    <a href="listening.html"{listening}>1:listening</a>
  </nav>
  <span class="status">stockholm, se</span>
</div></header>"""


def footer_panes(page):
    return f'<footer class="footer"><small class="subtitle">{RAILWAY}</small></footer>' if page == "index" else ""


CHROME = {
    "manual": (header_manual, footer_manual),
    "ledger": (header_ledger, footer_ledger),
    "panes": (header_panes, footer_panes),
}


def render(concept, page, head_extra):
    title, section = PAGES[page]
    header, footer = CHROME[concept]
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
{head_extra}
</head>
<body data-page="{page}">
<div class="page">{header(section)}
<div class="content">{BODIES[page]()}{footer(page)}</div>
</div>
<script src="../shared/preview.js" defer></script>
</body>
</html>
"""


def build_static():
    head = '<link rel="stylesheet" href="../shared/fonts.css">\n<link rel="stylesheet" href="style.css">'
    for concept in CONCEPTS:
        for page in PAGES:
            (ROOT / concept / f"{page}.html").write_text(render(concept, page, head))


# --- single-file viewer ----------------------------------------------------

FONT_FILES = {
    ("400", "normal"): "IosevkaSS08-Regular.woff2",
    ("400", "italic"): "IosevkaSS08-Italic.woff2",
    ("700", "normal"): "IosevkaSS08-Bold.woff2",
    ("700", "italic"): "IosevkaSS08-BoldItalic.woff2",
}


def subset_fonts():
    from fontTools import subset

    text = "".join(
        (ROOT / c / "style.css").read_text() for c in CONCEPTS
    ) + (ROOT / "shared" / "preview.js").read_text()
    for c in CONCEPTS:
        for p in PAGES:
            text += render(c, p, "")
    unicodes = sorted({ord(ch) for ch in text} | set(range(0x20, 0x7F)) | set(range(0xA0, 0x180)))
    faces = []
    for (weight, style), name in FONT_FILES.items():
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        font = subset.load_font(str(ASSETS / name), opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        buf = io.BytesIO()
        subset.save_font(font, buf, opts)
        data = base64.b64encode(buf.getvalue()).decode()
        faces.append(
            f'@font-face{{font-family:"Iosevka SS08";font-weight:{weight};font-style:{style};'
            f"font-display:block;src:url(data:font/woff2;base64,{data}) format(\"woff2\")}}"
        )
    return "".join(faces)


def build_viewer(out):
    fonts = subset_fonts()
    preview = (ROOT / "shared" / "preview.js").read_text()
    docs = {}
    for concept in CONCEPTS:
        css = (ROOT / concept / "style.css").read_text()
        for page in PAGES:
            doc = render(concept, page, f"<style>{css}</style>")
            doc = doc.replace(
                '<script src="../shared/preview.js" defer></script>',
                f"<script>{preview}</script>",
            )
            docs[f"{concept}/{page}"] = doc
    template = (ROOT / "shared" / "viewer.html").read_text()
    viewer = template.replace("\"__FONTS__\"", json.dumps(fonts)).replace(
        "\"__DOCS__\"", json.dumps(docs).replace("</", "<\\/")
    )
    pathlib.Path(out).write_text(viewer)


if __name__ == "__main__":
    build_static()
    # Keeps the output in the shape `pnpm lint` checks for.
    subprocess.run(["pnpm", "exec", "oxfmt", str(ROOT)], check=True)
    if "--viewer" in sys.argv:
        build_viewer(sys.argv[sys.argv.index("--viewer") + 1])
