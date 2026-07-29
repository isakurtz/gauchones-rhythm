"use client";

// AST-132: ajustes de jogo editáveis na tela de título, sem rebuild.
//
// O AV já era editável, mas o campo era `type="number"` controlado que
// reclampava a cada tecla: digitar "1200" virava 100 no primeiro dígito e no
// mobile dava a sensação de campo travado (relato da issue). Aqui todo campo
// numérico guarda um rascunho de texto enquanto está em foco e só confirma
// (com clamp) no blur/Enter — dá pra apagar tudo e digitar à vontade.

import { useId, useState } from "react";
import {
  resetTuning,
  setTuning,
  TUNING_DEFAULTS,
  TUNING_LIMITS,
  type Tuning,
} from "./tuning";

type NumericKey = Exclude<keyof Tuning, "scrollUp">;

function NumberField({
  label,
  hint,
  field,
  value,
}: {
  label: string;
  hint?: string;
  field: NumericKey;
  value: number;
}) {
  const id = useId();
  const { min, max, step } = TUNING_LIMITS[field];
  // null = não está sendo editado, mostra o valor do store
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft !== null && draft.trim() !== "") {
      const parsed = Number(draft.replace(",", "."));
      if (Number.isFinite(parsed)) setTuning({ [field]: parsed } as Partial<Tuning>);
    }
    setDraft(null); // volta a espelhar o store (já clampado/normalizado)
  }

  return (
    <label className="tune-field" htmlFor={id}>
      <span className="tune-label">
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      <input
        id={id}
        className="tune-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft ?? String(value)}
        aria-describedby={`${id}-range`}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, ""))}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
          // setas ajustam de step em step, como num campo numérico de verdade
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = draft !== null && draft !== "" ? Number(draft) : value;
            if (Number.isFinite(base)) {
              setTuning({
                [field]: base + (e.key === "ArrowUp" ? step : -step),
              } as Partial<Tuning>);
              setDraft(null);
            }
          }
        }}
      />
      <span className="tune-range" id={`${id}-range`}>
        {min}–{max}
      </span>
    </label>
  );
}

export function TuningPanel({ tuning }: { tuning: Tuning }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const isDefault =
    tuning.av === TUNING_DEFAULTS.av &&
    tuning.scrollUp === TUNING_DEFAULTS.scrollUp &&
    tuning.perfectMs === TUNING_DEFAULTS.perfectMs &&
    tuning.greatMs === TUNING_DEFAULTS.greatMs &&
    tuning.goodMs === TUNING_DEFAULTS.goodMs &&
    tuning.holdRegrabMs === TUNING_DEFAULTS.holdRegrabMs;

  return (
    <div className="tune">
      <button
        type="button"
        className="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Ajustes {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="tune-body" id={panelId}>
          <div className="song">
            <span className="song-name">Scroll</span>
            <div className="diffs">
              <button
                type="button"
                className={`ghost${tuning.scrollUp ? " sel" : ""}`}
                onClick={() => setTuning({ scrollUp: true })}
              >
                ↑ Sobe
              </button>
              <button
                type="button"
                className={`ghost${!tuning.scrollUp ? " sel" : ""}`}
                onClick={() => setTuning({ scrollUp: false })}
              >
                ↓ Desce
              </button>
            </div>
          </div>

          <div className="tune-grid">
            <NumberField label="AV" hint="velocidade" field="av" value={tuning.av} />
            <NumberField
              label="Perfect"
              hint="ms"
              field="perfectMs"
              value={tuning.perfectMs}
            />
            <NumberField label="Great" hint="ms" field="greatMs" value={tuning.greatMs} />
            <NumberField label="Good" hint="ms" field="goodMs" value={tuning.goodMs} />
            <NumberField
              label="Re-segurar"
              hint="ms"
              field="holdRegrabMs"
              value={tuning.holdRegrabMs}
            />
          </div>

          <p className="tune-note">
            Janelas em milissegundos, pra cada lado da nota. Precisam crescer de
            Perfect pra Good — valores fora disso são corrigidos ao salvar.
          </p>

          {!isDefault && (
            <button type="button" className="ghost" onClick={resetTuning}>
              Voltar ao padrão
            </button>
          )}
        </div>
      )}
    </div>
  );
}
