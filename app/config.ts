export const config = {
  url: "https://simon.dev",
  title: "Simon Kjellberg",
  description:
    "Fullstack engineer, specialized in React, Node.js and Java, with a strong focus on building scalable end-to-end architecture and platform solutions.",
  pages: [
    { href: "/", name: "home" },
    { href: "/listening", name: "listening" },
    { href: "/simon-bot", name: "simon-bot" },
  ],
  links: [
    { label: "GitHub", url: "https://github.com/simonkberg" },
    { label: "LinkedIn", url: "https://linkedin.com/in/simonkjellberg" },
  ],
  gtmId: "GTM-P3HX5HW",
  lastfmUsername: "magijo",
  location: "Stockholm, Sweden",
  lastfmSince: 2007,
  // next/image's remotePatterns: the optimiser refuses covers from anywhere else.
  lastfmCoverCdn: "https://lastfm-img.freetls.fastly.net/i/u/",
} as const;
