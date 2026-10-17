"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import {
  terminal,
  type ExecutionSummary,
} from "../../../../packages/contracts/src/index";

function JavaIcon() {
  return (
    <svg
      width="25"
      height="29"
      viewBox="0 0 30 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M17 2c7 5-9 7-3 12M21 7c-7 4 3 5-2 9"
        stroke="#e5bd82"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7 18h15l-2 10H9L7 18ZM22 19h2a3 3 0 0 1 0 6h-3M5 31c4 3 17 3 21-1M8 34h15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function outcome(item: ExecutionSummary) {
  if (!terminal(item.status))
    return item.status === "running" ? "Recording…" : "Preparing…";
  if (item.status === "completed")
    return item.result === "void"
      ? "Completed"
      : `Returned ${item.result ?? "—"}`;
  return item.errorType || item.status.replaceAll("_", " ");
}
function groupName(timestamp: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return timestamp >= today.getTime()
    ? "Today"
    : timestamp >= yesterday.getTime()
      ? "Yesterday"
      : "Earlier";
}
export default function ExecutionNavigation({
  executions,
  selectedId,
  openingId,
  loading,
  error,
  hasMore,
  busy,
  onSelect,
  onNew,
  onMore,
  onRefresh,
}: {
  executions: ExecutionSummary[];
  selectedId?: string;
  openingId?: string;
  loading: boolean;
  error: string;
  hasMore: boolean;
  busy: boolean;
  onSelect: (id: string) => Promise<boolean>;
  onNew: () => void;
  onMore: () => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false),
    [compact, setCompact] = useState(false);
  const sidebar = useRef<HTMLElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1180px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || !compact) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(
        sidebar.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || [],
      ).filter((element) => element.offsetParent !== null);
      const first = targets[0],
        last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, compact]);
  const groups = ["Today", "Yesterday", "Earlier"].map((name) => ({
    name,
    items: executions.filter((item) => groupName(item.createdAt) === name),
  }));
  return (
    <>
      <nav className="language-rail" aria-label="Languages">
        <button
          className="language-choice selected"
          aria-label="Java"
          aria-pressed="true"
          title="Java · selected"
          onClick={() => {
            if (compact) setOpen(true);
          }}
        >
          <JavaIcon />
          <span>Java</span>
        </button>
        <button
          className="history-toggle"
          aria-label="Open execution history"
          aria-controls="execution-history"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <History size={18} />
          <span>Executions</span>
        </button>
      </nav>
      {open && compact && (
        <button
          className="history-backdrop"
          tabIndex={-1}
          aria-label="Close execution history overlay"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="execution-history"
        ref={sidebar}
        className={`execution-sidebar ${open ? "is-open" : ""}`}
        role={compact && open ? "dialog" : "complementary"}
        aria-modal={compact && open ? true : undefined}
        aria-label="Execution history"
      >
        <div className="history-heading">
          <h2>Executions</h2>
          <button
            className="icon-button"
            aria-label="Refresh executions"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          <button
            ref={closeButton}
            className="icon-button sidebar-close"
            aria-label="Close execution history"
            onClick={() => setOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
        <button
          className="new-execution"
          disabled={busy}
          onClick={() => {
            onNew();
            setOpen(false);
          }}
        >
          <Plus size={16} />
          New execution
        </button>
        <div className="history-scroll" aria-busy={loading}>
          {error && (
            <div className="history-message" role="alert">
              <p>Couldn’t load executions.</p>
              <button className="text-button" onClick={onRefresh}>
                Try again
              </button>
            </div>
          )}
          {!error && executions.length === 0 && (
            <div className="history-message">
              {loading ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  <p>Loading executions…</p>
                </>
              ) : (
                <>
                  <History size={24} />
                  <p>No executions yet.</p>
                  <span>Run your code to start a history.</span>
                </>
              )}
            </div>
          )}
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <section
                  className="history-group"
                  key={group.name}
                  aria-label={group.name}
                >
                  <h3>{group.name}</h3>
                  <ul>
                    {group.items.map((item) => {
                      const title = `${item.methodName}(${item.arguments})`,
                        active = selectedId === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            className={`execution-item ${active ? "active" : ""}`}
                            data-testid="execution-item"
                            data-run-id={item.id}
                            aria-current={active ? "true" : undefined}
                            aria-label={`${title} · ${outcome(item)}`}
                            title={`${item.className}.${title}\n${new Date(item.createdAt).toLocaleString()} · ${outcome(item)}`}
                            disabled={busy || !!openingId}
                            onClick={async () => {
                              if (await onSelect(item.id)) setOpen(false);
                            }}
                          >
                            <span className="execution-name">{title}</span>
                            <span className="execution-meta">
                              <span
                                className={`execution-outcome ${terminal(item.status) && item.status !== "completed" ? "execution-failed" : ""}`}
                              >
                                {openingId === item.id ||
                                !terminal(item.status) ? (
                                  <LoaderCircle size={11} className="spin" />
                                ) : item.status === "completed" ? (
                                  <Check size={11} />
                                ) : (
                                  <CircleAlert size={11} />
                                )}
                                <span>{outcome(item)}</span>
                              </span>
                              <time
                                dateTime={new Date(
                                  item.createdAt,
                                ).toISOString()}
                              >
                                {new Date(item.createdAt).toLocaleTimeString(
                                  [],
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                              </time>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ),
          )}
          {hasMore && (
            <button
              className="load-executions"
              disabled={loading}
              onClick={onMore}
            >
              {loading ? "Loading…" : "Load earlier executions"}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
