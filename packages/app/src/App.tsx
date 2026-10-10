import { useMemo, useState } from "react";
import { CORE_VERSION, consume, initialRunLimits, remaining, RUN_LIMITS, type LimitedAction } from "@tow/core";
import { MockAdProvider, MockBillingProvider, MonetisationService, realDelay } from "@tow/platform";
import { baseContent } from "./content.ts";

/** Ad placeholder length; tests shorten it with ?adms=200. */
const adDurationMs = Number(new URLSearchParams(location.search).get("adms") ?? "2000");

export function App() {
  return (
    <main className="shell">
      <header className="title">
        <p className="eyebrow">A Tales of Words roguelike</p>
        <h1>Invasion</h1>
        <p className="tagline">Winter is over. The dead are walking south. Every word you know may keep you alive.</p>
        <button className="btn primary" type="button" disabled title="Combat arrives in milestone M1">
          Begin a tale
        </button>
        <p className="soon">Playable runs arrive with the combat core (M1) and run layer (M2).</p>
      </header>

      <BuildStatus />
      <MonetisationCheck />

      <footer className="foot">
        build <code>{__BUILD_SHA__}</code> · core {CORE_VERSION} · {__BUILD_TIME__.slice(0, 16).replace("T", " ")} UTC
      </footer>
    </main>
  );
}

function BuildStatus() {
  const ok = baseContent.issues.length === 0;
  return (
    <section className="panel" aria-labelledby="status-h">
      <h2 id="status-h">Foundations check</h2>
      <ul className="checks">
        <li data-testid="content-status" className={ok ? "ok" : "bad"}>
          {ok
            ? `Base content: ${baseContent.fileCount} files valid`
            : `Base content: ${baseContent.issues.length} issue(s), first: ${baseContent.issues[0]?.path} ${baseContent.issues[0]?.message}`}
        </li>
        <li className="ok">Rules core loaded in the browser</li>
      </ul>
    </section>
  );
}

/**
 * Exercises the real revive and reroll rules (core limits + MonetisationService)
 * with mock ads and purchases, so the flows can be tested and watched in a browser.
 */
function MonetisationCheck() {
  const [limits, setLimits] = useState(initialRunLimits);
  const [premium, setPremium] = useState(false);
  const [ad, setAd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const services = useMemo(() => {
    const billing = new MockBillingProvider();
    const ads = new MockAdProvider(realDelay, adDurationMs, (kind, placement) => setAd(`${kind} · ${placement}`));
    return { billing, monetisation: new MonetisationService(ads, billing, realDelay) };
  }, []);

  const note = (line: string) => setLog((prev) => [line, ...prev].slice(0, 6));

  async function attempt(action: LimitedAction) {
    if (remaining(limits, action) === 0) {
      note(`${action}: limit reached (${RUN_LIMITS[action]} per run)`);
      return;
    }
    setBusy(true);
    const res = await services.monetisation.requestGrant(action);
    setAd(null);
    if (!res.granted) {
      note(`${action}: ad closed early, no ${action}`);
    } else {
      const used = consume(limits, action, res.grant);
      setLimits(used.state);
      note(used.ok ? `${action} granted (${res.grant.source})` : `${action} refused: ${used.reason}`);
    }
    setBusy(false);
  }

  async function buyPremium() {
    await services.billing.purchase("premium");
    setPremium(true);
    note("Premium bought (test purchase)");
  }

  return (
    <section className="panel" aria-labelledby="money-h">
      <h2 id="money-h">Revive and reroll rules</h2>
      <p className="hint">Test panel using mock ads and purchases. The limits come from the rules core.</p>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void attempt("revive")} data-testid="revive">
          Revive · {remaining(limits, "revive")} left
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void attempt("reroll")} data-testid="reroll">
          ↻ Reroll · {remaining(limits, "reroll")} left
        </button>
      </div>
      <div className="row">
        <button type="button" className="btn ghost" disabled={busy || premium} onClick={() => void buyPremium()} data-testid="buy-premium">
          {premium ? "Premium owned" : "Buy Premium (test)"}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setLimits(initialRunLimits())} data-testid="new-run">
          New run
        </button>
      </div>
      <ol className="log" data-testid="log">
        {log.map((l, i) => (
          <li key={`${i}-${l}`}>{l}</li>
        ))}
      </ol>

      {ad && (
        <div className="ad" role="dialog" aria-label="Advertisement placeholder" data-testid="ad-placeholder">
          <p className="eyebrow">Advertisement placeholder</p>
          <p className="ad-kind">{ad}</p>
          <p className="hint">Real AdMob ads replace this on Android (M4).</p>
        </div>
      )}
    </section>
  );
}
