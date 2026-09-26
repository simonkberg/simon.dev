import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";

export const notFoundDescription =
  "The page you are looking for does not exist.";

export const NotFoundPage = () => (
  <Page section="Not Found">
    <section>
      <Heading level={2}>Page not found!</Heading>
      <p>{notFoundDescription}</p>
    </section>
  </Page>
);
