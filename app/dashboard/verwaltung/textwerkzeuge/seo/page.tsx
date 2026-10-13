import { TextToolPlaceholderPage } from "@/app/dashboard/verwaltung/textwerkzeuge/_components/text-tool-placeholder-page";

export default function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <TextToolPlaceholderPage tool="seo" searchParams={searchParams} />;
}
