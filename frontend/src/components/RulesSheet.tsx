import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { RISK_KEYS, RISK_LABEL, riskCss } from "../lib/risk";
import { Icon, spring } from "./ui";

const TABLE = [
  { name: "Wind", unit: "mph", bands: ["<25", "25–34", "35–44", "45–54", "≥55"] },
  { name: "Rain", unit: "in/hr", bands: ["<0.10", "0.10–0.25", "0.25–0.50", "0.50–1.00", ">1.00"] },
  { name: "Snow", unit: "in/hr", bands: ["<0.5", "0.5–1.0", "1.0–2.0", "2.0–3.0", ">3.0"] },
];

export function RulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="rules"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="rules__head">
              <h2 id="rules-title">How risk is scored</h2>
              <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
                <Icon name="close" size={16} />
              </button>
            </header>

            <section>
              <h3>1 · Classify each checkpoint</h3>
              <p>
                Weather is sampled every 10, 25 or 50 miles at the hour the truck is expected to <em>arrive</em> there.
                Each condition is classified, and the checkpoint takes the worst one.
              </p>
              <div className="rules__table-wrap">
                <table className="rules__table">
                  <thead>
                    <tr>
                      <th />
                      {RISK_KEYS.map((k) => (
                        <th key={k}>
                          <span className="risk-dot" style={{ background: riskCss(k) }} /> {RISK_LABEL[k]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TABLE.map((row) => (
                      <tr key={row.name}>
                        <th scope="row">
                          {row.name} <span className="muted">{row.unit}</span>
                        </th>
                        {row.bands.map((b) => (
                          <td key={b}>{b}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Shared edges go to the higher band (0.25 in/hr rain is High). “No Travel” for rain and snow is strictly
                above the top edge, so exactly 1.00 in/hr of rain is Severe.
              </p>
            </section>

            <section>
              <h3>2 · Apply load rules to wind</h3>
              <ul className="rules__list">
                <li>≥55 mph → No Travel for any load</li>
                <li>45–54 mph and over 30,000 lb → No Travel</li>
                <li>35–44 mph and over 40,000 lb → Severe</li>
              </ul>
            </section>

            <section>
              <h3>3 · Rank the three routes</h3>
              <ol className="rules__list">
                <li>Fewest No Travel miles (a route the rules forbid never wins)</li>
                <li>Fewest Severe miles</li>
                <li>Fewest High miles</li>
                <li>Lowest average risk (Low 0 → No Travel 4, weighted by miles)</li>
                <li>Shortest door-to-door travel time</li>
              </ol>
              <p className="muted small">
                Each checkpoint stands for half the distance to its neighbours, so a route’s risk miles always add up to
                its length.
              </p>
            </section>

            <section>
              <h3>Assumptions</h3>
              <ul className="rules__list muted">
                <li>Sustained 10 m wind is classified; gusts are shown but not scored.</li>
                <li>Rain includes showers. Precipitation uses the forecast hour that contains the ETA.</li>
                <li>Load weight is cargo only; the router adds 35,000 lb of tractor-trailer for weight limits.</li>
                <li>With HOS on, ETAs include a 30 min break after 8 h and 10 h off after 11 h of driving.</li>
              </ul>
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
