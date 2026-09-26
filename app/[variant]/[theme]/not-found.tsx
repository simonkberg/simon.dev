import { NotFoundPage, notFoundDescription } from "@/components/NotFoundPage";
import { config } from "@/config";

export default function NotFound() {
  return (
    <>
      <title>{`Not Found - ${config.title}`}</title>
      <meta name="description" content={notFoundDescription} />
      <NotFoundPage />
    </>
  );
}
