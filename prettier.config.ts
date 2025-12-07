import { type Config } from "prettier";

const config: Config = {
  objectWrap: "collapse",
  overrides: [{ files: "*.ts", options: { proseWrap: "always" } }],
};

export default config;
