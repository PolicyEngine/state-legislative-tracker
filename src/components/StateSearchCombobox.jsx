import { useState, useRef, useEffect, useCallback } from "react";
import { stateData } from "../data/states";
import { colors, typography, spacing } from "../designTokens";

const ALL_STATES = Object.entries(stateData).map(([abbr, s]) => ({
  abbr,
  name: s.name,
}));

export default function StateSearchCombobox({ onSelect, statesWithBills }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef(null);
  const containerRef = useRef(null);

  const filtered = query
    ? ALL_STATES.filter(
        (s) =>
          s.name.toLowerCase().startsWith(query.toLowerCase()) ||
          s.abbr.toLowerCase().startsWith(query.toLowerCase()),
      )
    : ALL_STATES;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIndex];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = useCallback(
    (abbr) => {
      setQuery("");
      setOpen(false);
      setActiveIndex(-1);
      onSelect(abbr);
    },
    [onSelect],
  );

  const handleKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      setActiveIndex(0);
      e.preventDefault();
      return;
    }
    if (!open) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i < filtered.length - 1 ? i + 1 : i));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i > 0 ? i - 1 : i));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && filtered[activeIndex]) {
          select(filtered[activeIndex].abbr);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const billCount = (abbr) => statesWithBills[abbr] || 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          border: `1px solid ${open ? colors.primary[400] : colors.border.light}`,
          borderRadius: spacing.radius.lg,
          backgroundColor: colors.background.secondary,
          padding: `${spacing.xs} ${spacing.md}`,
          transition: "border-color 0.15s ease",
          width: "160px",
        }}
      >
        {/* Magnifying glass */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.text.tertiary}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="state-search-listbox"
          aria-activedescendant={
            activeIndex >= 0 && filtered[activeIndex]
              ? `state-option-${filtered[activeIndex].abbr}`
              : undefined
          }
          aria-autocomplete="list"
          aria-label="Search states"
          placeholder="Search states"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(e.target.value ? 0 : -1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            width: "100%",
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.secondary[900],
          }}
        />
      </div>

      {open && (
        <ul
          id="state-search-listbox"
          role="listbox"
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            width: "260px",
            maxHeight: "320px",
            overflowY: "auto",
            backgroundColor: colors.white,
            border: `1px solid ${colors.border.light}`,
            borderRadius: spacing.radius.xl,
            boxShadow: "var(--shadow-elevation-medium)",
            padding: spacing.xs,
            margin: 0,
            listStyle: "none",
            zIndex: 100,
          }}
        >
          {filtered.length === 0 ? (
            <li
              style={{
                padding: `${spacing.sm} ${spacing.md}`,
                color: colors.text.tertiary,
                fontSize: typography.fontSize.sm,
                fontFamily: typography.fontFamily.body,
              }}
            >
              No states found
            </li>
          ) : (
            filtered.map((s, i) => {
              const count = billCount(s.abbr);
              const isActive = i === activeIndex;
              return (
                <li
                  key={s.abbr}
                  id={`state-option-${s.abbr}`}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => select(s.abbr)}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: `${spacing.sm} ${spacing.md}`,
                    borderRadius: spacing.radius.md,
                    cursor: "pointer",
                    backgroundColor: isActive
                      ? colors.background.secondary
                      : "transparent",
                    transition: "background-color 0.1s ease",
                  }}
                >
                  <span
                    style={{
                      fontSize: typography.fontSize.sm,
                      fontFamily: typography.fontFamily.body,
                      color: colors.secondary[900],
                    }}
                  >
                    <span
                      style={{
                        color: colors.text.tertiary,
                        fontWeight: typography.fontWeight.medium,
                        marginRight: spacing.sm,
                      }}
                    >
                      {s.abbr}
                    </span>
                    {s.name}
                  </span>
                  {count > 0 && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: typography.fontSize.xs,
                        fontFamily: typography.fontFamily.body,
                        color: colors.primary[600],
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: colors.primary[400],
                        }}
                      />
                      {count} {count === 1 ? "bill" : "bills"}
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
