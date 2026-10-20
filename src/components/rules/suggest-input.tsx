"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, X } from "@/components/icons";
import { cn } from "@/lib/utils";

export type Option = { email: string; name: string; reason: string };

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
export const looksLikeEmail = (v: string) => EMAIL.test(v.trim());

// Asks `load` for options while the field has focus: once on focus, then as the owner types (debounced).
function useOptions(load: (q: string) => Promise<Option[]>, open: boolean, q: string) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      setLoading(true);
      const r = await load(q.trim()).catch(() => []);
      if (n === seq.current) {
        setOptions(r);
        setLoading(false);
      }
    }, q ? 220 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);
  return { options, loading };
}

function OptionList({ id, options, active, loading, onPick, query, emptyHint }: { id: string; options: Option[]; active: number; loading: boolean; onPick: (o: Option) => void; query: string; emptyHint: string }) {
  return (
    <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-sm border bg-popover py-1 shadow-pop">
      <ul id={id} role="listbox">
        {options.map((o, i) => (
          <li
            key={o.email}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(o);
            }}
            className={cn("flex cursor-pointer flex-col px-3 py-1.5", i === active ? "bg-selected" : "hover:bg-hover")}
          >
            <span className="truncate text-dense">
              {o.name ? <span className="font-medium">{o.name}</span> : null}
              {o.name && " "}
              <span className={o.name ? "text-muted-foreground" : "font-medium"}>{o.email}</span>
            </span>
            <span className="truncate text-meta text-muted-foreground">{o.reason}</span>
          </li>
        ))}
      </ul>
      {options.length === 0 && (
        <p className="px-3 py-2 text-meta text-muted-foreground">{loading ? "Looking in your mailbox…" : query ? (looksLikeEmail(query) ? "Press Enter to add this address" : "No matches in your mailbox") : emptyHint}</p>
      )}
    </div>
  );
}

// Several addresses as chips. Suggestions come live from the mailbox; any valid address can also be typed.
export function RecipientInput({
  label,
  value,
  onChange,
  load,
  placeholder,
  invalidMessage = "That isn't a valid email address.",
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  load: (q: string, exclude: string[]) => Promise<Option[]>;
  placeholder?: string;
  invalidMessage?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { options: raw, loading } = useOptions((s) => load(s, value), open, q);
  const options = raw.filter((o) => !value.includes(o.email));

  const add = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    if (!looksLikeEmail(e)) {
      setError(invalidMessage);
      return;
    }
    if (!value.includes(e)) onChange([...value, e]);
    setQ("");
    setError(null);
    setActive(0);
  };

  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && q)) {
      if (!q && e.key !== "Enter") return;
      e.preventDefault();
      if (options[active] && !looksLikeEmail(q)) add(options[active].email);
      else if (q) add(q);
    } else if (e.key === "Backspace" && !q && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative">
      <div
        onClick={() => input.current?.focus()}
        className={cn(
          "flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-sm border border-input bg-card px-1.5 py-1 transition-[border-color,box-shadow] hover:border-border-strong focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
          error && "border-destructive",
        )}
      >
        {value.map((v) => (
          <span key={v} className="flex max-w-full items-center gap-1 rounded-sm bg-secondary py-0.5 pr-0.5 pl-1.5 text-meta">
            <span className="truncate">{v}</span>
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== v));
              }}
              className="grid size-4 place-items-center rounded-[2px] text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && options[active] ? `${id}-list-${active}` : undefined}
          aria-invalid={Boolean(error)}
          value={q}
          placeholder={value.length ? undefined : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (q && looksLikeEmail(q)) add(q);
          }}
          onKeyDown={key}
          className="h-6 min-w-32 flex-1 bg-transparent px-1 text-dense outline-none placeholder:text-subtle"
        />
        {loading && open && <LoaderCircle className="mr-1 size-3.5 animate-spin text-subtle" aria-hidden="true" />}
      </div>
      {open && <OptionList id={`${id}-list`} options={options} active={active} loading={loading} onPick={(o) => add(o.email)} query={q} emptyHint="Type a name or address" />}
      {error && <p className="mt-1 text-meta text-destructive">{error}</p>}
    </div>
  );
}

// One sender: an email address or a domain. Suggestions are people who recently sent you attachments.
export function SenderInput({ value, onChange, load, invalid }: { value: string; onChange: (v: string) => void; load: (q: string) => Promise<Option[]>; invalid?: string | null }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { options, loading } = useOptions(load, open, value);
  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label="Sender"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && options[active] ? `${id}-list-${active}` : undefined}
        aria-invalid={Boolean(invalid)}
        value={value}
        placeholder="name@company.com or company.com"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            onChange(options[active].email);
            setOpen(false);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className={cn(
          "h-8 w-full rounded-sm border border-input bg-card px-2.5 text-dense outline-none transition-[border-color,box-shadow] placeholder:text-subtle hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          invalid && "border-destructive",
        )}
      />
      {open && (
        <OptionList
          id={`${id}-list`}
          options={options}
          active={active}
          loading={loading}
          onPick={(o) => {
            onChange(o.email);
            setOpen(false);
          }}
          query={value}
          emptyHint="People who sent you attachments appear here"
        />
      )}
      {invalid && <p className="mt-1 text-meta text-destructive">{invalid}</p>}
    </div>
  );
}
