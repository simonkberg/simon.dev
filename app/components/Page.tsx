import type { PropsWithChildren } from "react";

import { ExternalLink } from "@/components/ExternalLink";
import { Header } from "@/components/Header";
import { PreferenceSwitch } from "@/components/PreferenceSwitch";
import { Subtitle } from "@/components/Subtitle";
import { themePreference, variantPreference } from "@/lib/preferences";

interface PageProps extends PropsWithChildren {
  section?: string;
}

export const Page = ({ section, children }: PageProps) => (
  <div className="page">
    <Header section={section} />
    <div className="content">
      {children}
      <footer className="footer">
        <Subtitle>
          Hosted on{" "}
          <ExternalLink href="https://railway.com?referralCode=wzuAxn">
            Railway
          </ExternalLink>{" "}
          (affiliate link).
        </Subtitle>
        <div className="preferences">
          <PreferenceSwitch preference={variantPreference} />
          <PreferenceSwitch preference={themePreference} />
        </div>
      </footer>
    </div>
  </div>
);
