import type { Provenance, Quote, RetrievedDoc } from "./state";

export function isFileDoc(doc: RetrievedDoc) {
  const origin = String(doc.metadata.origin ?? "");
  const source = String(doc.metadata.source ?? "");
  if (origin === "upload" || origin === "sample") return true;
  return source.toLowerCase().endsWith(".txt");
}

export function isWebDoc(doc: RetrievedDoc) {
  const source = String(doc.metadata.source ?? "");
  return (
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source === "tavily" ||
    Boolean(doc.metadata.error)
  );
}

export function fileSourcesOf(docs: RetrievedDoc[]) {
  const names: string[] = [];
  for (const doc of docs) {
    if (!isFileDoc(doc)) continue;
    const source = String(doc.metadata.source ?? "").trim();
    if (source && !names.includes(source)) names.push(source);
  }
  return names;
}

export function webSourcesOf(docs: RetrievedDoc[]) {
  const names: string[] = [];
  for (const doc of docs) {
    if (!isWebDoc(doc)) continue;
    const source = String(doc.metadata.source ?? "").trim();
    if (source && source !== "tavily" && !names.includes(source)) names.push(source);
  }
  return names;
}

export function pickQuote(docs: RetrievedDoc[]): Quote | undefined {
  const doc = docs.find(isFileDoc);
  if (!doc) return undefined;
  const source = String(doc.metadata.source ?? "").trim() || "file";
  const cleaned = doc.pageContent.replace(/^Source file:.*\n+/i, "").trim();
  const line =
    cleaned
      .split(/\n+/)
      .map((part) => part.trim())
      .find((part) => part.length > 12) ?? cleaned;
  const text = line.slice(0, 220).trim();
  if (!text) return undefined;
  return { source, text };
}

export function buildProvenance(options: {
  mode: "auto" | "files" | "web";
  route: string;
  relevant: boolean;
  documents: RetrievedDoc[];
}): Provenance {
  const fileSources = fileSourcesOf(options.documents);
  const webSources = webSourcesOf(options.documents);
  const quote = pickQuote(options.documents);

  if (options.mode === "files") {
    if (!options.relevant || fileSources.length === 0) {
      return {
        kind: "files",
        label: "Not in your documents",
        fileSources,
        webSources: [],
      };
    }
    const names = fileSources.join(", ");
    return {
      kind: "files",
      label: names ? `From your files · ${names}` : "From your files",
      fileSources,
      webSources: [],
      quote,
    };
  }

  if (options.mode === "web" || options.route === "search") {
    if (fileSources.length > 0 && webSources.length > 0) {
      return {
        kind: "mixed",
        label: "From your files and the web",
        fileSources,
        webSources,
        quote,
      };
    }
    return {
      kind: "web",
      label: "From the web",
      fileSources: [],
      webSources,
    };
  }

  if (options.route === "general") {
    return {
      kind: "model",
      label: "Not from your files · model only",
      fileSources: [],
      webSources: [],
    };
  }

  if (fileSources.length > 0 && webSources.length > 0) {
    return {
      kind: "mixed",
      label: "From your files and the web",
      fileSources,
      webSources,
      quote,
    };
  }
  if (fileSources.length > 0) {
    return {
      kind: "files",
      label: `From your files · ${fileSources.join(", ")}`,
      fileSources,
      webSources: [],
      quote,
    };
  }
  if (webSources.length > 0) {
    return {
      kind: "web",
      label: "From the web",
      fileSources: [],
      webSources,
    };
  }
  return {
    kind: "model",
    label: "Not from your files · model only",
    fileSources: [],
    webSources: [],
  };
}
