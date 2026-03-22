import { loader } from "fumadocs-core/source";
import { source as createSource } from "fumadocs-core/source";
import type { PageData, MetaData } from "fumadocs-core/source";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const DOCS_DIR = path.join(process.cwd(), "content/docs");

interface RawDoc {
  slugs: string[];
  filePath: string;
  data: { title: string; description?: string };
  rawContent: string;
}

function collectDocs(dir: string, slugPrefix: string[] = []): RawDoc[] {
  const results: RawDoc[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectDocs(fullPath, [...slugPrefix, entry.name]));
      continue;
    }

    if (!entry.name.endsWith(".md") && !entry.name.endsWith(".mdx")) continue;

    const raw = fs.readFileSync(fullPath, "utf-8");
    const { data, content } = matter(raw);

    const baseName = entry.name.replace(/\.mdx?$/, "");
    const slugs =
      baseName === "index" ? slugPrefix : [...slugPrefix, baseName];

    results.push({
      slugs,
      filePath: fullPath,
      data: {
        title: (data.title as string) || baseName,
        description: data.description as string | undefined,
      },
      rawContent: content,
    });
  }

  return results;
}

interface RawMeta {
  dirPath: string;
  title?: string;
  pages?: string[];
}

function collectMeta(dir: string, slugPrefix: string[] = []): RawMeta[] {
  const results: RawMeta[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectMeta(fullPath, [...slugPrefix, entry.name]));
      continue;
    }

    if (entry.name !== "meta.json") continue;

    const raw = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as {
      title?: string;
      pages?: string[];
    };

    results.push({
      dirPath: slugPrefix.join("/"),
      title: raw.title,
      pages: raw.pages,
    });
  }

  return results;
}

const allDocs = collectDocs(DOCS_DIR);
const allMeta = collectMeta(DOCS_DIR);

// Build virtual file list for fumadocs source()
const virtualPages = allDocs.map((doc) => ({
  type: "page" as const,
  path: doc.slugs.length === 0 ? "index.md" : `${doc.slugs.join("/")}.md`,
  slugs: doc.slugs,
  data: {
    title: doc.data.title,
    description: doc.data.description,
  } as PageData,
}));

const virtualMetas = allMeta.map((m) => ({
  type: "meta" as const,
  path: m.dirPath ? `${m.dirPath}/meta.json` : "meta.json",
  data: {
    title: m.title,
    pages: m.pages,
  } as MetaData,
}));

const fsSource = createSource({
  pages: virtualPages,
  metas: virtualMetas,
});

export const source = loader({
  baseUrl: "/docs",
  source: fsSource,
});

/** Get raw markdown content for a page by slugs */
export function getDocContent(slugs: string[]): string | null {
  const doc = allDocs.find(
    (d) =>
      d.slugs.length === slugs.length &&
      d.slugs.every((s, i) => s === slugs[i]),
  );
  return doc?.rawContent ?? null;
}
