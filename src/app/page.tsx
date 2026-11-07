"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, FileText, FileUp, Globe, LogOut, Menu, MessageSquarePlus, PanelLeft, Send, Sparkles, Trash2, X } from "lucide-react";
import { AuthScreen } from "@/components/auth-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type HopMetric = {
  name: string;
  ms: number;
  tokens?: number;
};

type AnswerMode = "auto" | "files" | "web";

type Provenance = {
  kind: "files" | "web" | "mixed" | "model";
  label: string;
  fileSources: string[];
  webSources: string[];
  quote?: { source: string; text: string };
};

type Message = {
  role: "user" | "assistant";
  content: string;
  route?: string;
  trace?: string[];
  sources?: string[];
  metrics?: HopMetric[];
  provenance?: Provenance;
};

type IndexedFile = {
  filename: string;
  origin: string;
  chunks: number;
  canDelete: boolean;
};

type Conversation = {
  sessionId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

const SESSION_KEY = "adaptive-rag-session";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthUser = { id: string; email: string };

function openChatId() {
  const existing = window.localStorage.getItem(SESSION_KEY)?.trim() ?? "";
  const id = UUID_RE.test(existing) ? existing : crypto.randomUUID();
  window.localStorage.setItem(SESSION_KEY, id);
  return id;
}

const SUGGESTIONS = [
  { label: "Index", text: "What rewrite budget does this Adaptive RAG demo use?" },
  { label: "General", text: "What is 2 + 2?" },
  { label: "Search", text: "Who won the most recent UEFA Champions League final?" },
];

const ANSWER_MODES: { id: AnswerMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "files", label: "My files" },
  { id: "web", label: "Web only" },
];

function pipelineVariant(route?: string) {
  if (route === "search") return "search" as const;
  if (route === "general") return "general" as const;
  if (route === "index") return "index" as const;
  return "muted" as const;
}

function pipelineLabel(route?: string) {
  if (route === "index") return "Index";
  if (route === "search") return "Search";
  if (route === "general") return "General";
  return null;
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function provenanceVariant(kind?: Provenance["kind"]) {
  if (kind === "web") return "web" as const;
  if (kind === "mixed") return "mixed" as const;
  if (kind === "files") return "files" as const;
  return "model" as const;
}

function formatMetrics(metrics?: HopMetric[]) {
  if (!metrics?.length) return "";
  const ms = metrics.reduce((sum, hop) => sum + hop.ms, 0);
  const tokens = metrics.reduce((sum, hop) => sum + (hop.tokens ?? 0), 0);
  const hops = metrics
    .map((hop) => `${hop.name} ${hop.ms}ms${hop.tokens ? `/${hop.tokens}tok` : ""}`)
    .join(" · ");
  return tokens > 0 ? `${ms}ms · ${tokens} tok · ${hops}` : `${ms}ms · ${hops}`;
}

function chipTone(step: string) {
  if (step.includes("search") || step.startsWith("webSearch")) {
    return "bg-sky-400/20 text-sky-200";
  }
  if (step.includes("general")) return "bg-emerald-400/15 text-emerald-200";
  if (step.includes("=no") || step.includes("skipped")) {
    return "bg-rose-400/15 text-rose-200";
  }
  return "bg-primary/15 text-primary";
}

export default function HomePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [indexedFiles, setIndexedFiles] = useState<IndexedFile[]>([]);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("auto");
  const [lockedFile, setLockedFile] = useState("");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(kind: "success" | "error", text: string) {
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    setToast({ kind, text });
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }

  const loadIndexedFiles = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/sources");
      if (res.status === 401) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as { files?: IndexedFile[] };
      if (Array.isArray(data.files)) {
        setIndexedFiles(data.files);
      }
    } catch {
      // keep last list
    }
  }, [user]);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/sessions");
      if (res.status === 401) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as { sessions?: Conversation[] };
      if (Array.isArray(data.sessions)) {
        setConversations(data.sessions);
      }
    } catch {
      // surfaced by query load
    }
  }, [user]);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as AuthUser;
      })
      .then((account) => {
        if (account?.id && account.email) {
          setUser(account);
          setSessionId(openChatId());
        }
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    void loadIndexedFiles();
  }, [loadIndexedFiles]);

  useEffect(() => {
    if (!sessionId) return;
    void loadConversations();
  }, [sessionId, loadConversations]);

  useEffect(() => {
    if (!sessionId) return;
    void fetch(`/api/query?sessionId=${sessionId}`)
      .then(async (res) => {
        if (res.status === 401) {
          setUser(null);
          return null;
        }
        const data = (await res.json()) as {
          history?: Message[];
          chunksIndexed?: number;
          error?: string;
        };
        if (res.status === 404) {
          const id = crypto.randomUUID();
          window.localStorage.setItem(SESSION_KEY, id);
          setSessionId(id);
          setMessages([]);
          setStatus("New chat");
          return null;
        }
        return data;
      })
      .then((data) => {
        if (!data) return;
        if (data.error) {
          setStatus(data.error);
          return;
        }
        if (Array.isArray(data.history)) {
          setMessages(data.history);
        }
        if (typeof data.chunksIndexed === "number") {
          setStatus(`${data.chunksIndexed} docs in Qdrant`);
        }
      })
      .catch(() => setStatus("MongoDB unavailable"));
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const canAsk = useMemo(
    () => Boolean(sessionId) && question.trim().length > 0 && !busy,
    [sessionId, question, busy],
  );

  function openConversation(id: string) {
    window.localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);
    setQuestion("");
  }

  function signIn(account: AuthUser) {
    setUser(account);
    setMessages([]);
    setConversations([]);
    setIndexedFiles([]);
    setSessionId(openChatId());
    setStatus("Signed in");
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setSessionId(null);
    setMessages([]);
    setConversations([]);
    setIndexedFiles([]);
    setQuestion("");
  }

  async function onDeleteFile(filename: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = (await res.json()) as { error?: string; files?: IndexedFile[] };
      if (!res.ok) {
        showToast("error", data.error ?? "Could not remove the file.");
        return;
      }
      if (Array.isArray(data.files)) {
        setIndexedFiles(data.files);
      } else {
        await loadIndexedFiles();
      }
      showToast("success", `${filename} was removed from the index.`);
      if (lockedFile === filename) {
        setLockedFile("");
        setAnswerMode("auto");
      }
    } catch {
      showToast("error", "Could not remove the file.");
    } finally {
      setBusy(false);
    }
  }

  function setMode(mode: AnswerMode) {
    setAnswerMode(mode);
    if (mode !== "files") {
      setLockedFile("");
    }
  }

  function toggleFileLock(filename: string) {
    if (lockedFile === filename && answerMode === "files") {
      setLockedFile("");
      return;
    }
    setLockedFile(filename);
    setAnswerMode("files");
  }

  function composerPlaceholder() {
    if (answerMode === "web") return "Search the web…";
    if (answerMode === "files" && lockedFile) return `Ask about ${lockedFile}…`;
    if (answerMode === "files") return "Ask about your indexed files…";
    return "Message Adaptive RAG…";
  }

  function startNewConversation() {
    const id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);
    setMessages([]);
    setQuestion("");
    setStatus("New chat");
    setAnswerMode("auto");
    setLockedFile("");
  }

  async function onUpload(file: File) {
    if (!user) {
      showToast("error", "Sign in to index a file.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".txt")) {
      showToast("error", "Only .txt files can be indexed.");
      return;
    }
    setBusy(true);
    setStatus("Indexing…");
    try {
      const body = new FormData();
      body.append("file", file);
      if (sessionId) body.append("sessionId", sessionId);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = (await res.json()) as {
        error?: string;
        chunks?: number;
        filename?: string;
        reused?: boolean;
      };
      if (!res.ok) {
        const message = data.error ?? "Upload failed";
        setStatus(message);
        showToast("error", message);
        return;
      }
      const name = data.filename ?? file.name;
      const chunks = data.chunks ?? 0;
      setStatus(`Indexed ${name} · ${chunks} chunks`);
      showToast(
        "success",
        data.reused
          ? `${name} was already indexed. Using the existing copy.`
          : `${name} was indexed (${chunks} chunks).`,
      );
      await loadIndexedFiles();
    } catch {
      setStatus("Upload failed");
      showToast("error", "Could not index the file. Is Qdrant running?");
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    if (!sessionId || !text.trim() || busy) return;
    const query = text.trim();
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: query }]);
    setBusy(true);
    setStatus("Thinking…");
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          sessionId,
          mode: answerMode,
          lockedFile: answerMode === "files" ? lockedFile : "",
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        answer?: string;
        route?: string;
        trace?: string[];
        chunksIndexed?: number;
        sources?: string[];
        metrics?: HopMetric[];
        provenance?: Provenance;
      };
      if (res.status === 401) {
        setUser(null);
        return;
      }
      if (!res.ok) {
        setStatus(data.error ?? "Query failed");
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
          sources: data.sources,
          metrics: data.metrics,
          provenance: data.provenance,
        },
      ]);
      setStatus(
        `${pipelineLabel(data.route) ?? "Answer"} · ${data.chunksIndexed ?? "?"} chunks`,
      );
      await loadConversations();
    } catch {
      setStatus("Query failed");
    } finally {
      setBusy(false);
    }
  }

  function onAsk(event: FormEvent) {
    event.preventDefault();
    void send(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(question);
    }
  }

  if (!authReady) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Connecting…
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSuccess={signIn} />;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <AnimatePresence initial={false}>
        {sidebarOpen ? (
          <motion.aside
            key="sidebar"
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex w-[280px] shrink-0 flex-col border-r border-border bg-card/60"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-primary" />
                Adaptive RAG
              </div>
              <Button variant="ghost" size="iconSm" onClick={() => setSidebarOpen(false)}>
                <PanelLeft className="size-4" />
              </Button>
            </div>
            <div className="px-3 pb-3">
              <Button className="w-full" size="sm" onClick={startNewConversation} disabled={busy}>
                <MessageSquarePlus className="size-4" />
                New chat
              </Button>
            </div>
            <ScrollArea className="flex-1 px-2 pb-4">
              <p className="px-2 pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Chats
              </p>
              {conversations.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  Send a message and it will show up here.
                </p>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((item) => (
                    <li key={item.sessionId}>
                      <button
                        type="button"
                        onClick={() => openConversation(item.sessionId)}
                        disabled={busy}
                        className={cn(
                          "w-full rounded-xl px-3 py-2 text-left transition-colors",
                          item.sessionId === sessionId
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )}
                      >
                        <span className="line-clamp-2 text-sm">{item.title}</span>
                        <span className="mt-1 block text-[11px] opacity-70">
                          {item.messageCount} msgs
                          {item.updatedAt ? ` · ${formatWhen(item.updatedAt)}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-5 px-2 pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Indexed files
              </p>
              {indexedFiles.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  Sample files are shared. Your uploads stay on this account.
                </p>
              ) : (
                <ul className="space-y-1">
                  {indexedFiles.map((file) => {
                    const locked = lockedFile === file.filename && answerMode === "files";
                    return (
                      <li
                        key={`${file.origin}-${file.filename}`}
                        className={cn(
                          "flex items-center gap-1 rounded-xl px-1 py-1 text-xs",
                          locked && "bg-primary/10",
                        )}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleFileLock(file.filename)}
                          className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left hover:bg-accent"
                          title={
                            locked
                              ? "Unlock — answer from all indexed files"
                              : "Answer from this file only"
                          }
                        >
                          <p className="truncate text-foreground">{file.filename}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {locked
                              ? "This file only"
                              : `${file.origin} · ${file.chunks} chunks`}
                          </p>
                        </button>
                        {file.canDelete ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="iconSm"
                            disabled={busy}
                            aria-label={`Remove ${file.filename}`}
                            onClick={() => void onDeleteFile(file.filename)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {indexedFiles.length > 0 ? (
                <p className="mt-2 px-2 text-[11px] text-muted-foreground">
                  Click a file to lock answers to it. Uploads belong to this
                  account.
                </p>
              ) : null}
            </ScrollArea>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3">
              <p className="min-w-0 truncate text-xs text-muted-foreground">{user.email}</p>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                aria-label="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {!sidebarOpen ? (
              <Button variant="ghost" size="iconSm" onClick={() => setSidebarOpen(true)}>
                <Menu className="size-4" />
              </Button>
            ) : null}
            <div>
              <p className="text-sm font-medium">Chat</p>
              <p className="text-xs text-muted-foreground">{status}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUpload(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !user}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="size-4" />
              Index .txt
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6">
            {messages.length === 0 && !busy ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="m-auto max-w-lg text-center"
              >
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Sparkles className="size-6" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">How can I help?</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Choose Auto, My files, or Web only. Click a file in the sidebar to answer from
                  that file alone. Every reply shows where it came from.
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  {SUGGESTIONS.map((item) => (
                    <button
                      key={item.text}
                      type="button"
                      onClick={() => void send(item.text)}
                      className="rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm hover:bg-accent"
                    >
                      <span className="mr-2 text-xs text-primary">{item.label}</span>
                      {item.text}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col gap-5">
                <AnimatePresence initial={false}>
                  {messages.map((message, index) => {
                    const pipeline = pipelineLabel(message.route);
                    const isUser = message.role === "user";
                    return (
                      <motion.article
                        key={`${message.role}-${index}-${message.content.slice(0, 12)}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22 }}
                        className={cn("flex", isUser ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-6",
                            isUser
                              ? "rounded-br-md bg-primary text-primary-foreground"
                              : "rounded-bl-md bg-card text-foreground",
                          )}
                        >
                          {!isUser ? (
                            <div className="mb-2 flex flex-wrap items-center gap-1">
                              {message.provenance ? (
                                <Badge variant={provenanceVariant(message.provenance.kind)}>
                                  {message.provenance.label}
                                </Badge>
                              ) : null}
                              {pipeline ? (
                                <Badge variant={pipelineVariant(message.route)}>{pipeline}</Badge>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="whitespace-pre-wrap">{message.content}</div>
                          {message.provenance?.quote ? (
                            <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">
                              <p className="italic">“{message.provenance.quote.text}”</p>
                              <footer className="mt-1 not-italic opacity-80">
                                {message.provenance.quote.source}
                              </footer>
                            </blockquote>
                          ) : null}
                          {message.sources && message.sources.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {message.sources.map((source) => (
                                <span
                                  key={source}
                                  className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  {source}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {message.trace && message.trace.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1 font-mono text-[10px]">
                              {message.trace.map((step, stepIndex) => (
                                <span
                                  key={`${step}-${stepIndex}`}
                                  className={cn("rounded-full px-2 py-0.5", chipTone(step))}
                                >
                                  {step}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {formatMetrics(message.metrics) ? (
                            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                              {formatMetrics(message.metrics)}
                            </p>
                          ) : null}
                        </div>
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
                {busy ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <div className="rounded-3xl rounded-bl-md bg-card px-4 py-3">
                      <div className="flex gap-1">
                        {[0, 1, 2].map((dot) => (
                          <motion.span
                            key={dot}
                            className="size-1.5 rounded-full bg-muted-foreground"
                            animate={{ y: [0, -4, 0] }}
                            transition={{ duration: 0.6, repeat: Infinity, delay: dot * 0.12 }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {toast ? (
            <motion.div
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className={cn(
                "pointer-events-none absolute bottom-28 right-6 z-50 flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg",
                toast.kind === "success"
                  ? "border-emerald-500/30 bg-card text-foreground"
                  : "border-rose-500/30 bg-card text-foreground",
              )}
            >
              {toast.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
              ) : (
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-rose-400" />
              )}
              <p>{toast.text}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl">
            {answerMode === "files" && lockedFile ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] text-foreground">
                  <FileText className="size-3" />
                  This file only · {lockedFile}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-background/60"
                    aria-label="Unlock file"
                    onClick={() => setLockedFile("")}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </div>
            ) : null}
            <div className="mb-2 flex flex-wrap gap-1">
              {ANSWER_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setMode(mode.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px]",
                    answerMode === mode.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent",
                  )}
                >
                  {mode.id === "auto" ? <Sparkles className="size-3" /> : null}
                  {mode.id === "files" ? <FileText className="size-3" /> : null}
                  {mode.id === "web" ? <Globe className="size-3" /> : null}
                  {mode.label}
                </button>
              ))}
            </div>
            <form onSubmit={onAsk} className="flex items-end gap-2">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={composerPlaceholder()}
                className="max-h-36 min-h-12"
              />
              <Button type="submit" size="icon" disabled={!canAsk} aria-label="Send">
                <Send className="size-4" />
              </Button>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
