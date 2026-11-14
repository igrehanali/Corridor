import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Place } from "../lib/types";
import { Spinner } from "./ui";

interface Props {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  placeholder: string;
  icon: React.ReactNode;
  error?: string;
}

/** Accessible combobox with debounced, cancellable place search. */
export function PlaceInput({ label, value, onChange, placeholder, icon, error }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const typed = useRef(false);

  // Reflect external changes (swap, example trips, URL restore).
  // Typing clears ``value`` (the text no longer matches a chosen place), so a
  // null value must not wipe what the user is typing.
  useEffect(() => {
    if (value) {
      typed.current = false;
      setText(value.label);
    } else if (!typed.current) {
      setText("");
    }
  }, [value]);

  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await api.geocode(q, ctrl.signal);
        setResults(found);
        setFailed(false);
        setActive(found.length ? 0 : -1);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [text]);

  const choose = (p: Place) => {
    typed.current = false;
    setText(p.label);
    setOpen(false);
    setResults([]);
    onChange(p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`field place${error ? " has-error" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="place__control">
        <span className="place__icon">{icon}</span>
        <input
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={!!error}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {loading && (
          <span className="place__status">
            <Spinner size={14} />
          </span>
        )}
      </div>
      <AnimatePresence>
        {open && (results.length > 0 || (!loading && text.trim().length >= 2)) && (
          <motion.ul
            id={listId}
            role="listbox"
            className="place__list"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            {results.map((p, i) => (
              <li
                key={`${p.label}-${p.lat}`}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`place__option${i === active ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
              >
                <span className="place__name">{p.label.split(", ")[0]}</span>
                <span className="place__detail">{p.label.split(", ").slice(1).join(", ")}</span>
              </li>
            ))}
            {results.length === 0 && (
              <li className="place__empty">{failed ? "Search is unavailable right now" : "No matching places"}</li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}
