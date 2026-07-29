// AST-132: ajustes do minigame que precisam ser mexidos SEM rebuild.
//
// Antes o AV e a direção do scroll eram dois stores ad-hoc dentro do
// RhythmGame; as janelas de judgment eram const de módulo, então afinar a
// sensação de timing exigia editar o arquivo e rebuildar. Agora tudo mora
// aqui, num store único persistido em localStorage e lido por
// useSyncExternalStore.
//
// Os valores default são a referência documentada em docs/MINIGAME.md —
// mudar aqui é mudar o que o jogador novo pega.

export type Tuning = {
  /** velocidade de scroll, estilo Pump. approach = AV_CALIBRATION / av */
  av: number;
  /** true = setas sobem (receptor no topo); false = descem */
  scrollUp: boolean;
  /** janelas de judgment, em ms (tolerância pra cada lado da nota) */
  perfectMs: number;
  greatMs: number;
  goodMs: number;
  /** hold solto por até esse tempo pode ser re-segurado sem cair */
  holdRegrabMs: number;
};

export const TUNING_DEFAULTS: Readonly<Tuning> = Object.freeze({
  av: 600,
  scrollUp: true,
  perfectMs: 70,
  greatMs: 140,
  goodMs: 210,
  holdRegrabMs: 250,
});

// Limites de sanidade dos campos numéricos. São largos de propósito: o
// objetivo é calibrar jogando, não impor um "certo".
export const TUNING_LIMITS: Record<
  Exclude<keyof Tuning, "scrollUp">,
  { min: number; max: number; step: number }
> = {
  av: { min: 100, max: 2000, step: 10 },
  perfectMs: { min: 10, max: 300, step: 5 },
  greatMs: { min: 10, max: 400, step: 5 },
  goodMs: { min: 10, max: 500, step: 5 },
  holdRegrabMs: { min: 0, max: 1000, step: 10 },
};

const STORAGE_KEY = "rhythm-tuning";
const EVENT = "rhythm-tuning";

// Chaves antigas (AV e scroll tinham storage próprio antes da AST-132).
// Lidas uma vez na migração pra ninguém perder a calibração que já fez.
const LEGACY_AV = "rhythm-av";
const LEGACY_SCROLL = "rhythm-scroll";

function clampNumber(key: Exclude<keyof Tuning, "scrollUp">, value: unknown): number {
  const { min, max } = TUNING_LIMITS[key];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return TUNING_DEFAULTS[key];
  return Math.min(max, Math.max(min, n));
}

// As janelas precisam ser crescentes (perfect ⊂ great ⊂ good), senão o
// julgamento fica inalcançável: `judge()` compara em cascata e uma great
// menor que a perfect nunca seria atingida.
function normalize(raw: Partial<Tuning>): Tuning {
  const perfectMs = clampNumber("perfectMs", raw.perfectMs ?? TUNING_DEFAULTS.perfectMs);
  const greatMs = Math.max(
    perfectMs,
    clampNumber("greatMs", raw.greatMs ?? TUNING_DEFAULTS.greatMs)
  );
  const goodMs = Math.max(greatMs, clampNumber("goodMs", raw.goodMs ?? TUNING_DEFAULTS.goodMs));
  return {
    av: clampNumber("av", raw.av ?? TUNING_DEFAULTS.av),
    scrollUp: typeof raw.scrollUp === "boolean" ? raw.scrollUp : TUNING_DEFAULTS.scrollUp,
    perfectMs,
    greatMs,
    goodMs,
    holdRegrabMs: clampNumber(
      "holdRegrabMs",
      raw.holdRegrabMs ?? TUNING_DEFAULTS.holdRegrabMs
    ),
  };
}

function readStorage(): Tuning {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalize(JSON.parse(stored) as Partial<Tuning>);

    const legacy: Partial<Tuning> = {};
    const av = Number(localStorage.getItem(LEGACY_AV));
    if (Number.isFinite(av) && av > 0) legacy.av = av;
    const scroll = localStorage.getItem(LEGACY_SCROLL);
    if (scroll !== null) legacy.scrollUp = scroll === "up";
    return normalize(legacy);
  } catch {
    // Safari em modo privado antigo joga ao tocar em localStorage
    return { ...TUNING_DEFAULTS };
  }
}

// useSyncExternalStore exige identidade estável entre snapshots: sem esse
// cache, cada render devolveria um objeto novo e o React entraria em loop.
let cached: Tuning | null = null;

export function getTuning(): Tuning {
  if (!cached) cached = readStorage();
  return cached;
}

export function getServerTuning(): Tuning {
  return TUNING_DEFAULTS as Tuning;
}

export function subscribeTuning(cb: () => void) {
  window.addEventListener(EVENT, cb);
  // outra aba mexeu nos ajustes: invalida o cache e re-renderiza
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTuning(patch: Partial<Tuning>) {
  cached = normalize({ ...getTuning(), ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function resetTuning() {
  cached = { ...TUNING_DEFAULTS };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}
