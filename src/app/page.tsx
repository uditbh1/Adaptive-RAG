"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  route?: string;
  trace?: string[];
};

const SESSION_KEY = "adaptive-rag-session";

function chipClass(step: string) {
  if (step.startsWith("route=search") || step.startsWith("webSearch")) {
    return "chip search";
  }
  if (step.startsWith("route=general") || step === "general") {
    return "chip general";
  }
  if (step.includes("=no") || step.includes("skipped")) {
    return "chip no";
  }
  return "chip";
}

function pipelineLabel(route?: string) {
  if (route === "index") return "Index";
  if (route === "search") return "Search";
  if (route === "general") return "General";
  return null;
}

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("Connecting to session…");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const existing = window.localStorage.getItem(SESSION_KEY);
    const id = existing ?? crypto.randomUUID();
    if (!existing) {
      window.localStorage.setItem(SESSION_KEY, id);
    }
    setSessionId(id);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void fetch(`/api/query?sessionId=${sessionId}`)
      .then((res) => res.json())
      .then((data: { history?: Message[]; chunksIndexed?: number; error?: string }) => {
        if (data.error) {
          setStatus(data.error);
          return;
        }
        if (Array.isArray(data.history)) {
          setMessages(data.history);
        }
        if (typeof data.chunksIndexed === "number") {
          setStatus(
            `${data.chunksIndexed} chunks in Qdrant. Chat is saved in MongoDB for this session.`,
          );
        }
      })
      .catch(() => setStatus("Could not load session. Is MongoDB running?"));
  }, [sessionId]);

  const canAsk = useMemo(
    () => Boolean(sessionId) && question.trim().length > 0 && !busy,
    [sessionId, question, busy],
  );

  function startNewConversation() {
    const id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);
    setMessages([]);
    setStatus("New session. History starts empty; indexed documents stay in Qdrant.");
  }

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setStatus("Choose a .txt file first.");
      return;
    }
    setBusy(true);
    setStatus("Indexing into Qdrant…");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = (await res.json()) as { error?: string; chunks?: number; filename?: string };
      if (!res.ok) {
        setStatus(data.error ?? "Upload failed.");
        return;
      }
      setStatus(`Indexed ${data.filename} in Qdrant. Total chunks: ${data.chunks}.`);
    } catch {
      setStatus("Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    if (!canAsk || !sessionId) return;
    const query = question.trim();
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: query }]);
    setBusy(true);
    setStatus("Classifying query type…");
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sessionId }),
      });
      const data = (await res.json()) as {
        error?: string;
        answer?: string;
        route?: string;
        trace?: string[];
        chunksIndexed?: number;
      };
      if (!res.ok) {
        setStatus(data.error ?? "Query failed.");
        setMessages((current) => [
          ...current,
          { role: "assistant", content: data.error ?? "Query failed." },
        ]);
        return;
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer ?? "",
          route: data.route,
          trace: data.trace,
        },
      ]);
      const pipeline = pipelineLabel(data.route) ?? data.route;
      setStatus(
        `Pipeline: ${pipeline}. Chunks in Qdrant: ${data.chunksIndexed ?? "?"}.`,
      );
    } catch {
      setStatus("Query failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="header">
        <h1>Adaptive RAG</h1>
        <p>
          Intelligent query routing classifies each question into one pipeline.
          Index uses your documents in Qdrant. Search uses the live web. General
          uses the model only. Chat history is stored in MongoDB and survives refresh.
        </p>
      </header>

      <section className="pipelines" aria-label="Query types">
        <article>
          <h3>Index</h3>
          <p>Answerable from uploaded documents in Qdrant.</p>
        </article>
        <article>
          <h3>General</h3>
          <p>Answerable from general knowledge. No retrieval.</p>
        </article>
        <article>
          <h3>Search</h3>
          <p>Needs real-time web search.</p>
        </article>
      </section>

      <section className="panel">
        <h2>Upload a .txt file</h2>
        <form className="upload-row" onSubmit={onUpload}>
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button type="submit" disabled={busy}>
            Index file
          </button>
        </form>
        <p className="status">{status}</p>
      </section>

      <section className="panel">
        <h2>Ask</h2>
        <form onSubmit={onAsk}>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Try: What rewrite budget does this Adaptive RAG demo use?"
          />
          <div className="ask-row" style={{ marginTop: 10 }}>
            <button type="submit" disabled={!canAsk}>
              {busy ? "Running graph…" : "Run Adaptive RAG"}
            </button>
            <button type="button" className="secondary" onClick={startNewConversation} disabled={busy}>
              New conversation
            </button>
          </div>
        </form>

        <div className="messages">
          {messages.length === 0 ? (
            <p className="empty">
              No turns yet. Refresh keeps this session. The sample knowledge base
              is indexed into Qdrant on first use.
            </p>
          ) : (
            messages.map((message, index) => {
              const pipeline = pipelineLabel(message.route);
              return (
                <article key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
                  <div className="who">
                    {message.role}
                    {pipeline ? (
                      <span className={`pipeline-tag ${message.route}`}>{pipeline}</span>
                    ) : null}
                  </div>
                  <div className="answer">{message.content}</div>
                  {message.trace && message.trace.length > 0 ? (
                    <div className="trace" aria-label="graph path">
                      {message.trace.map((step, stepIndex) => (
                        <span key={`${step}-${stepIndex}`} className={chipClass(step)}>
                          {step}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
