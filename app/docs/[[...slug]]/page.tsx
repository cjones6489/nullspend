import { source, getDocContent } from "@/lib/source";
import { notFound } from "next/navigation";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { compileMDX } from "@fumadocs/mdx-remote";
import defaultMdxComponents from "fumadocs-ui/mdx";

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const rawContent = getDocContent(slug);
  if (!rawContent) notFound();

  const compiled = await compileMDX({
    source: rawContent,
  });

  return (
    <DocsPage toc={compiled.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <compiled.body components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
