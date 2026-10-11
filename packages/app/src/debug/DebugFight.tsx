// Debug fight page (task M1.3c), reachable at #debug. A developer tool for watching real fights from
// the rules core before the combat screen arrives in M3; it is not a game screen and doesn't follow the
// mockups. Text is plain English on purpose: code rule 5 (localisation keys) doesn't apply here.
// The fight lives in a ref; rendering only reads it, and a counter bump re-renders after each action.
import { useRef, useState, type ReactElement } from "react";
import { POWER_IDS, STAT_IDS, STATUS_IDS, type DamageType } from "@tow/core";
import {
  DEFAULT_PRESET,
  isCapped,
  isPresetId,
  logGroups,
  MAX_HITS,
  MAX_ROUNDS,
  nameOf,
  nextTurn,
  powerLabel,
  PRESETS,
  presetSetup,
  runToEnd,
  startFight,
  toCount,
  unitView,
  type AttackSetup,
  type Fight,
  type FightSetup,
  type PresetId,
  type SideKey,
  type UnitSetup,
} from "./fight-model.ts";

type Phase = "setup" | "running" | "capped" | "over";

const toDamageType = (value: string): DamageType => (value === "arcane" ? "arcane" : "physical");

const withSide = (setup: FightSetup, side: SideKey, unit: UnitSetup): FightSetup =>
  side === "player" ? { ...setup, player: unit } : { ...setup, enemy: unit };

export function DebugFight(): ReactElement {
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [setup, setSetup] = useState<FightSetup>(() => presetSetup(DEFAULT_PRESET));
  const [seed, setSeed] = useState("debug");
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const fight = useRef<Fight | null>(null);

  const refresh = (): void => {
    const f = fight.current;
    setPhase(f === null ? "setup" : f.state.over ? "over" : isCapped(f) ? "capped" : "running");
    setVersion((v) => v + 1);
  };

  const choosePreset = (value: string): void => {
    if (!isPresetId(value)) return;
    setPreset(value);
    setSetup(presetSetup(value));
  };

  const start = (): void => {
    try {
      fight.current = startFight(setup, seed);
      setError(null);
    } catch (e) {
      fight.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
    refresh();
  };

  const step = (): void => {
    if (fight.current !== null) nextTurn(fight.current);
    refresh();
  };

  const runAll = (): void => {
    if (fight.current !== null) runToEnd(fight.current);
    refresh();
  };

  const reset = (): void => {
    fight.current = null;
    setError(null);
    refresh();
  };

  const editing = phase === "setup";
  const f = fight.current;

  return (
    <main className="shell debug">
      <header className="debug-head">
        <h1>Debug fight</h1>
        <p className="hint">
          Rules test with the real combat core · build <code>{__BUILD_SHA__}</code>
        </p>
        <a className="debug-link" href="#" data-testid="debug-back">
          ← Back to the title screen
        </a>
      </header>

      <section className="panel" aria-labelledby="setup-h">
        <h2 id="setup-h">Setup</h2>
        <label className="field">
          <span>Preset</span>
          <select data-testid="preset" value={preset} disabled={!editing} onChange={(e) => choosePreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Seed</span>
          <input data-testid="seed" type="text" value={seed} disabled={!editing} onChange={(e) => setSeed(e.target.value)} />
        </label>
      </section>

      <UnitEditor side="player" unit={setup.player} disabled={!editing} onChange={(u) => setSetup((s) => withSide(s, "player", u))} />
      <UnitEditor side="enemy" unit={setup.enemy} disabled={!editing} onChange={(u) => setSetup((s) => withSide(s, "enemy", u))} />

      <section className="panel controls" aria-label="Fight controls">
        <div className="row">
          <button type="button" className="btn" data-testid="start" disabled={phase !== "setup"} onClick={start}>
            Start fight
          </button>
          <button type="button" className="btn" data-testid="next" disabled={phase !== "running"} onClick={step}>
            Next turn
          </button>
          <button type="button" className="btn" data-testid="run" disabled={phase !== "running"} onClick={runAll}>
            Run to end
          </button>
          <button type="button" className="btn ghost" data-testid="reset" onClick={reset}>
            Reset
          </button>
        </div>
        <p className="hint">Next turn plays one unit&apos;s turn. Run to end stops after {MAX_ROUNDS} rounds.</p>
        {phase === "capped" && (
          <p className="debug-error" data-testid="capped">
            Stopped after {MAX_ROUNDS} rounds
          </p>
        )}
        {error !== null && <p className="debug-error">Could not start: {error}</p>}
      </section>

      {f !== null && <FightView fight={f} />}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Setup editors

interface NumberFieldProps {
  testId: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}

function NumberField({ testId, label, value, disabled, onChange, min = 0, max }: NumberFieldProps): ReactElement {
  // While the field has focus it shows the raw text, so clearing it and typing "5" gives "5", not "05".
  // Each change is parsed and committed at once (empty or invalid = 0), so Start always sees the number;
  // on blur the field shows the committed number again.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        data-testid={testId}
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(toCount(e.target.value));
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

interface UnitEditorProps {
  side: SideKey;
  unit: UnitSetup;
  disabled: boolean;
  onChange: (unit: UnitSetup) => void;
}

function UnitEditor({ side, unit, disabled, onChange }: UnitEditorProps): ReactElement {
  const id = (name: string): string => `${side}-${name}`;
  const setAttack = (a: Partial<AttackSetup>): void => onChange({ ...unit, attack: { ...unit.attack, ...a } });

  return (
    <section className="panel" data-testid={`unit-${side}`} aria-label={nameOf(side)}>
      <h2>{nameOf(side)}</h2>

      <div className="fields">
        <NumberField testId={id("hp")} label="HP" value={unit.hp} disabled={disabled} onChange={(n) => onChange({ ...unit, hp: n })} />
        <NumberField testId={id("maxHp")} label="Max HP" value={unit.maxHp} disabled={disabled} onChange={(n) => onChange({ ...unit, maxHp: n })} />
        <NumberField testId={id("shield")} label="Shield" value={unit.shield} disabled={disabled} onChange={(n) => onChange({ ...unit, shield: n })} />
        <NumberField
          testId={id("maxShield")}
          label="Max Shield"
          value={unit.maxShield}
          disabled={disabled}
          onChange={(n) => onChange({ ...unit, maxShield: n })}
        />
      </div>

      <h3>Stats</h3>
      <div className="fields">
        {STAT_IDS.map((s) => (
          <NumberField
            key={s}
            testId={id(`stat-${s}`)}
            label={nameOf(s)}
            value={unit.stats[s]}
            disabled={disabled}
            onChange={(n) => onChange({ ...unit, stats: { ...unit.stats, [s]: n } })}
          />
        ))}
      </div>

      <h3>Powers</h3>
      <div className="fields">
        {POWER_IDS.map((p) => (
          <NumberField
            key={p}
            testId={id(`power-${p}`)}
            label={`${powerLabel(p)} power`}
            value={unit.powers[p]}
            disabled={disabled}
            onChange={(n) => onChange({ ...unit, powers: { ...unit.powers, [p]: n } })}
          />
        ))}
      </div>

      <h3>Attack</h3>
      <div className="fields">
        <label className="field">
          <span>Type</span>
          <select
            data-testid={id("attack-type")}
            value={unit.attack.type}
            disabled={disabled}
            onChange={(e) => setAttack({ type: toDamageType(e.target.value) })}
          >
            <option value="physical">physical</option>
            <option value="arcane">arcane</option>
          </select>
        </label>
        <NumberField testId={id("attack-amount")} label="Amount" value={unit.attack.amount} disabled={disabled} onChange={(n) => setAttack({ amount: n })} />
        <NumberField
          testId={id("attack-hits")}
          label="Hits"
          min={1}
          max={MAX_HITS}
          value={unit.attack.hits}
          disabled={disabled}
          onChange={(n) => setAttack({ hits: Math.min(MAX_HITS, Math.max(1, n)) })}
        />
        <label className="field check">
          <input
            type="checkbox"
            data-testid={id("attack-piercing")}
            checked={unit.attack.piercing}
            disabled={disabled}
            onChange={(e) => setAttack({ piercing: e.target.checked })}
          />
          <span>Piercing</span>
        </label>
      </div>

      <details data-testid={`${side}-statuses`}>
        <summary>Starting statuses</summary>
        <div className="fields">
          {STATUS_IDS.map((s) => (
            <NumberField
              key={s}
              testId={id(`status-${s}`)}
              label={nameOf(s)}
              value={unit.statuses[s]}
              disabled={disabled}
              onChange={(n) => onChange({ ...unit, statuses: { ...unit.statuses, [s]: n } })}
            />
          ))}
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Fight view and log

const percent = (n: number, max: number): string => `${max > 0 ? Math.round((100 * n) / max) : 0}%`;

function FightView({ fight }: { fight: Fight }): ReactElement {
  const { state } = fight;
  const groups = logGroups(fight.ctx.events);
  return (
    <section className="panel" data-testid="fight" aria-labelledby="fight-h">
      <h2 id="fight-h">Fight</h2>
      <p className="fight-status">
        {/* At the cap the core has already moved into round 51; show the last round played. */}
        <span data-testid="round">Round {isCapped(fight) ? MAX_ROUNDS : state.round}</span>
        {state.active !== null && !isCapped(fight) && <span data-testid="active">Next: {nameOf(state.active.id)}</span>}
        {state.winner !== null && <span data-testid="winner">Winner: {nameOf(state.winner)}</span>}
      </p>
      <FightUnit side="player" fight={fight} />
      <FightUnit side="enemy" fight={fight} />

      <h3>Event log</h3>
      <div className="fight-log" data-testid="log">
        {groups.map((g, gi) => (
          <div className="log-group" key={gi}>
            {g.header !== null && <p className="turn-head">{g.header}</p>}
            <ul className="log">
              {g.lines.map((l, li) => (
                <li key={li} data-type={l.type}>
                  {l.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function FightUnit({ side, fight }: { side: SideKey; fight: Fight }): ReactElement {
  const v = unitView(fight.units[side]);
  return (
    <div className={`fight-unit${v.fallen ? " fallen" : ""}`} data-testid={`fight-${side}`}>
      <p className="fight-name">
        {v.name}
        {v.fallen ? " (fallen)" : ""}
      </p>
      <p className="meter-label">
        HP {v.hp}/{v.maxHp}
      </p>
      <div className="bar hp" aria-hidden="true">
        <span style={{ width: percent(v.hp, v.maxHp) }} />
      </div>
      <p className="meter-label">
        Shield {v.shield}/{v.maxShield}
      </p>
      <div className="bar shield" aria-hidden="true">
        <span style={{ width: percent(v.shield, v.maxShield) }} />
      </div>
      {v.powers.length > 0 && <p className="hint">Powers: {v.powers.join(" · ")}</p>}
      {v.chips.length > 0 && (
        <ul className="chips">
          {v.chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
