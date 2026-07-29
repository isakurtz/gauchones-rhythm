"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GAU } from "@/lib/design";
import { getServerTuning, getTuning, subscribeTuning, type Tuning } from "./tuning";
import { TuningPanel } from "./TuningPanel";
import "./rhythm.css";

// Versão standalone (repo gauchones-rhythm): o mesmo jogo do site do Gauchones,
// sem sorteio de brinde (AST-91) e sem ranking (AST-131) — os dois dependem de
// conta, server action e banco, que aqui não existem. O que sobra roda 100% no
// cliente e pode ser exportado como HTML estático.
//
// fetch() não passa pelo basePath do Next, então caminho absoluto de asset
// quebraria no GitHub Pages (o site vive sob /gauchones-rhythm/).
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const BPM = 128;
const SPB = 60 / BPM; // segundos por beat
const TOTAL_BEATS = 128; // 32 compassos ~ 60s
const APPROACH = 1.5; // seg que a nota fica visível

const LANES = 5; // ordem: DL, UL, C, UR, DR
const LANE_KEYS: Record<string, number> = { z: 0, q: 1, s: 2, e: 3, c: 4 };
// numpad espelha o pad: 1=DL, 7=UL, 5=C, 9=UR, 3=DR (via e.code, independe do NumLock)
const LANE_CODES: Record<string, number> = {
  Numpad1: 0,
  Numpad7: 1,
  Numpad5: 2,
  Numpad9: 3,
  Numpad3: 4,
};
// AST-130: paleta do design system (GAU) no lugar da antiga. Decisão da Isa:
// setas pra CIMA (UL/UR) em rosé, pra BAIXO (DL/DR) em sage, centro em âmbar.
const LANE_COLOR = [GAU.sage, GAU.rose, GAU.amber, GAU.rose, GAU.sage];
const LANE_ROT = [225, -45, 0, 45, 135]; // graus; 0 = losango central
// Deslocamento vertical de cada receptor, em múltiplos de colW — é o que dá a
// forma do stage. AST-130: zerado = linha reta (era [0.32,-0.5,-0.09,-0.5,0.32],
// que desenhava um X). Mexer aqui é a única coisa necessária pra mudar a forma.
const LANE_LIFT = [0, 0, 0, 0, 0];

const ROOTS = [55, 43.65, 65.41, 49]; // Am F C G
const ARP = [220, 261.63, 293.66, 329.63, 392, 440]; // pentatônica Am

type JudgeRes = "perfect" | "great" | "good" | "miss";
const JCOL: Record<JudgeRes, string> = {
  perfect: GAU.amber,
  great: GAU.sage,
  good: "#ede4d3", // --display (creme do design system)
  miss: "#8a7f70",
};
// --bg do design system (near-black aquecido), pro canvas que não lê var()
const BG = "#0d0b09";

const JTXT: Record<JudgeRes, string> = {
  perfect: "PERFECT",
  great: "GREAT",
  good: "GOOD",
  miss: "MISS",
};

type Note = {
  t: number;
  lane: number;
  d: number; // duração do hold em segundos (0 = tap)
  judged: boolean; // cabeça julgada (tap ou início do hold)
  res: JudgeRes | null;
  holdEnd: "ok" | "ng" | null; // cauda do hold: completada ou derrubada
  releasedAt: number | null; // instante em que soltou (pra janela de re-segurar)
  awarded: number; // pontos creditados pela cabeça (estornados se derrubar)
};

const HOLD_OK_PTS = 50;

// AV constante (como no Pump moderno): velocidade de scroll independente do BPM.
// approach(av) = AV_CALIBRATION / av — mesma fórmula pra qualquer BPM.
// O fator 2 é calibração empírica: no arcade de verdade, AV~600-620 numa S14
// fica com sensação parecida com o que aqui batia em ~300 antes desse ajuste.
// Ainda é aproximado (nosso "campo de visão" de setas não é idêntico ao do
// arcade) — por isso o campo de AV é livre, pra afinar jogando (ver ./tuning.ts).
const AV_CALIBRATION = APPROACH * 170 * 2;

type SongChart = {
  label: string;
  meter: number;
  bpm: number;
  duration: number;
  notes: [number, number, number?][]; // [t, lane] tap; [t, lane, dur] hold
};
type Song = {
  slug: string;
  title: string;
  artist: string;
  charts: SongChart[];
};
// o que o jogador escolheu na tela de título
type TrackSel = { kind: "synth" } | { kind: "song"; slug: string; chartIdx: number };

export default function RhythmGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [sel, setSel] = useState<TrackSel>({ kind: "synth" });
  const [loading, setLoading] = useState(false);
  const selRef = useRef<TrackSel>({ kind: "synth" });

  // AST-132: AV, direção do scroll e janelas de judgment num store só, editável
  // na tela de título sem rebuild. O loop de render lê pelo ref (o efeito roda
  // uma vez e não pode fechar sobre o valor de um render antigo).
  const tuning = useSyncExternalStore(subscribeTuning, getTuning, getServerTuning);
  const tuningRef = useRef<Tuning>(getServerTuning());
  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

  const songsRef = useRef<Song[]>([]);
  const apiRef = useRef<{ start: () => void; toTitle: () => void } | null>(null);

  function choose(s: TrackSel) {
    selRef.current = s;
    setSel(s);
  }

  // músicas convertidas do StepMania (npm run charts); sem elas fica só a demo synth
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx: { slug: string; title: string; artist: string }[] = await fetch(
          `${BASE}/songs/index.json`
        ).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`/songs/index.json: HTTP ${r.status}`))
        );
        const loaded = await Promise.all(
          idx.map(async (m) => {
            const data = await fetch(`${BASE}/songs/${m.slug}/chart.json`).then((r) =>
              r.ok
                ? r.json()
                : Promise.reject(new Error(`/songs/${m.slug}/chart.json: HTTP ${r.status}`))
            );
            return { slug: m.slug, ...data } as Song;
          })
        );
        if (!cancelled) {
          songsRef.current = loaded;
          setSongs(loaded);
        }
      } catch (err) {
        // sem public/songs/ o jogo segue só com a síntese, mas deixa o motivo
        // no console (404 = build sem músicas; redirect/401 = deployment protection)
        console.warn("[rhythm] músicas indisponíveis:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;

    // AST-130: o canvas 2D não entende var(), então lê a pilha já resolvida das
    // custom properties de rhythm.css — que apontam pras fontes globais do site
    // (Industry Demi Italic no display, Source Code Pro no corpo). Enquanto o
    // kit da Adobe não carrega, o canvas usa o fallback e passa a usar a
    // Industry sozinho, porque g.font é reatribuído a cada frame.
    const cssVars = getComputedStyle(cv);
    const fontDisplay = cssVars.getPropertyValue("--rhythm-display").trim() || "sans-serif";
    const fontMono = cssVars.getPropertyValue("--rhythm-mono").trim() || "monospace";

    const hud = document.getElementById("hud")!;
    const scrTitle = document.getElementById("scr-title")!;
    const scrResults = document.getElementById("scr-results")!;
    const flashEl = document.getElementById("flash")!;
    const tcv = document.getElementById("tcv")!;
    const scv = document.getElementById("scv")!;
    const gv = document.getElementById("gradev")!;
    const rP = document.getElementById("r-p")!;
    const rG = document.getElementById("r-g")!;
    const rO = document.getElementById("r-o")!;
    const rM = document.getElementById("r-m")!;
    const rC = document.getElementById("r-c")!;
    const rS = document.getElementById("r-s")!;

    let ctxA: AudioContext | null = null;
    let noiseBuf: AudioBuffer | null = null;
    let state: "title" | "count" | "play" | "results" = "title";
    let songStart = 0;
    let schedBeat = 0;
    let schedTimer: ReturnType<typeof setInterval> | null = null;
    let notes: Note[] = [];
    let stats = { perfect: 0, great: 0, good: 0, miss: 0 };
    let score = 0,
      combo = 0,
      maxCombo = 0;
    let judgeFx: { text: string; color: string; t: number } = {
      text: "",
      color: "#fff",
      t: -9,
    };
    let laneFlash = [0, 0, 0, 0, 0];
    // quantas entradas (teclas/toques) seguram cada pista agora — estado físico,
    // não é resetado entre partidas
    const laneHeld = [0, 0, 0, 0, 0];
    let rafId = 0;

    let W = 0,
      H = 0,
      DPR = 1;
    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv!.clientWidth;
      H = cv!.clientHeight;
      cv!.width = W * DPR;
      cv!.height = H * DPR;
      g!.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    window.addEventListener("resize", resize);
    resize();

    function layout() {
      const fieldW = Math.min(W, 520);
      const colW = fieldW / LANES;
      const x0 = (W - fieldW) / 2;
      const baseY = tuningRef.current.scrollUp
        ? Math.max(120, H * 0.16) + colW * 0.2
        : H - Math.max(120, H * 0.16) - colW * 0.2;
      const recY = LANE_LIFT.map((l) => baseY + l * colW);
      return { colW, x0, recY, size: colW * 0.72 };
    }

    function buildChart(): Note[] {
      const n: Note[] = [];
      const mk = (t: number, lane: number, d: number): Note => ({
        t,
        lane,
        d,
        judged: false,
        res: null,
        holdEnd: null,
        releasedAt: null,
        awarded: 0,
      });
      const add = (beat: number, ...ls: number[]) =>
        ls.forEach((l) => n.push(mk(beat * SPB, l, 0)));
      const hold = (beat: number, beats: number, ...ls: number[]) =>
        ls.forEach((l) => n.push(mk(beat * SPB, l, beats * SPB)));
      [2, 2, 1, 3, 2, 2, 0, 4].forEach((l, i) => add(8 + i, l));
      const A = [
        [0, 1, 2, 3],
        [4, 3, 2, 1],
        [0, 4, 1, 3],
        [2, 1, 2, 3],
      ];
      for (let bar = 4; bar < 12; bar++) {
        const p = A[bar % 4];
        for (let b = 0; b < 4; b++) add(bar * 4 + b, p[b]);
      }
      const B = [
        [0, 1, 2, 3, 4, 2],
        [4, 3, 2, 1, 0, 2],
        [1, 0, 2, 4, 3, 2],
        [0, 4, 2, 1, 3, 2],
      ];
      const OFF = [0, 1, 1.5, 2, 3, 3.5];
      for (let bar = 12; bar < 20; bar++) {
        const p = B[bar % 4];
        for (let i = 0; i < 6; i++) add(bar * 4 + OFF[i], p[i]);
      }
      const C = [
        [1, 2, 3, 2, 1, 2],
        [3, 2, 1, 2, 3, 2],
        [0, 2, 4, 2, 0, 2],
        [4, 2, 0, 2, 4, 2],
      ];
      const OFFC = [1, 1.5, 2, 2.5, 3, 3.5];
      for (let bar = 20; bar < 28; bar++) {
        if (bar % 2 === 0) add(bar * 4, 0, 4);
        else add(bar * 4, 1, 3);
        const p = C[bar % 4];
        for (let i = 0; i < 6; i++) add(bar * 4 + OFFC[i], p[i]);
      }
      const F = [2, 1, 3, 2, 0, 2, 4, 2, 1, 3, 0, 4];
      for (let i = 0; i < 12; i++) add(112 + i, F[i]);
      hold(124, 2, 1, 3); // finale: segura os dois por 2 beats
      n.sort((a, b) => a.t - b.t);
      return n;
    }

    function initAudio() {
      if (ctxA) return;
      ctxA = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const len = ctxA.sampleRate * 1;
      noiseBuf = ctxA.createBuffer(1, len, ctxA.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    function env(gain: GainNode, t: number, peak: number, dur: number) {
      gain.gain.setValueAtTime(peak, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    }
    function kick(t: number) {
      const o = ctxA!.createOscillator(),
        v = ctxA!.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
      env(v, t, 0.9, 0.24);
      o.connect(v).connect(ctxA!.destination);
      o.start(t);
      o.stop(t + 0.26);
    }
    function hat(t: number, open: boolean) {
      const s = ctxA!.createBufferSource(),
        v = ctxA!.createGain(),
        f = ctxA!.createBiquadFilter();
      s.buffer = noiseBuf;
      f.type = "highpass";
      f.frequency.value = 7500;
      env(v, t, 0.14, open ? 0.22 : 0.045);
      s.connect(f).connect(v).connect(ctxA!.destination);
      s.start(t);
      s.stop(t + 0.25);
    }
    function clap(t: number) {
      const s = ctxA!.createBufferSource(),
        v = ctxA!.createGain(),
        f = ctxA!.createBiquadFilter();
      s.buffer = noiseBuf;
      f.type = "bandpass";
      f.frequency.value = 1700;
      f.Q.value = 1.1;
      env(v, t, 0.4, 0.13);
      s.connect(f).connect(v).connect(ctxA!.destination);
      s.start(t);
      s.stop(t + 0.16);
    }
    function bass(t: number, freq: number) {
      const o = ctxA!.createOscillator(),
        v = ctxA!.createGain(),
        f = ctxA!.createBiquadFilter();
      o.type = "sawtooth";
      o.frequency.value = freq;
      f.type = "lowpass";
      f.frequency.value = 620;
      f.Q.value = 1.2;
      env(v, t, 0.26, 0.2);
      o.connect(f).connect(v).connect(ctxA!.destination);
      o.start(t);
      o.stop(t + 0.22);
    }
    function lead(t: number, freq: number) {
      const o = ctxA!.createOscillator(),
        v = ctxA!.createGain(),
        f = ctxA!.createBiquadFilter();
      o.type = "square";
      o.frequency.value = freq;
      f.type = "lowpass";
      f.frequency.value = 2600;
      env(v, t, 0.075, 0.18);
      o.connect(f).connect(v).connect(ctxA!.destination);
      o.start(t);
      o.stop(t + 0.2);
    }
    function tick(t: number, hi: boolean) {
      const o = ctxA!.createOscillator(),
        v = ctxA!.createGain();
      o.type = "square";
      o.frequency.value = hi ? 1320 : 880;
      env(v, t, 0.15, 0.07);
      o.connect(v).connect(ctxA!.destination);
      o.start(t);
      o.stop(t + 0.08);
    }

    function scheduleStep(b: number) {
      const t = songStart + b * SPB;
      const bar = Math.floor(b / 4),
        inBar = b % 4,
        off = b % 1 === 0.5;
      if (off) hat(t, bar >= 20 && inBar === 3.5);
      if (!off && b >= 16) kick(t);
      if (!off && b >= 48 && (inBar === 1 || inBar === 3)) clap(t);
      const root = ROOTS[bar % 4];
      if (b >= 4) bass(t, off ? root * 2 : root);
      if (b >= 48) {
        const i = Math.floor(b * 2);
        lead(t, ARP[i % ARP.length] * (bar >= 20 ? 1 : 0.5));
      }
      if (b === 124) {
        hat(t, true);
        clap(t);
      }
    }
    function scheduler() {
      if (!ctxA || state === "results" || state === "title") return;
      const horizon = ctxA.currentTime + 0.18;
      while (schedBeat < TOTAL_BEATS && songStart + schedBeat * SPB < horizon) {
        scheduleStep(schedBeat);
        schedBeat += 0.5;
      }
    }

    // trilha em jogo: SPB/duração mudam conforme a música escolhida
    let curSPB = SPB;
    let curDuration = TOTAL_BEATS * SPB + 1.0;
    let srcNode: AudioBufferSourceNode | null = null;
    let starting = false;
    const audioCache = new Map<string, AudioBuffer>();

    function stopAudio() {
      if (srcNode) {
        try {
          srcNode.stop();
        } catch {}
        srcNode = null;
      }
    }

    function beginPlay(trackNotes: Note[], spb: number, duration: number, buffer: AudioBuffer | null) {
      notes = trackNotes;
      stats = { perfect: 0, great: 0, good: 0, miss: 0 };
      score = 0;
      combo = 0;
      maxCombo = 0;
      judgeFx.t = -9;
      laneFlash = [0, 0, 0, 0, 0];
      curSPB = spb;
      curDuration = duration;
      songStart = ctxA!.currentTime + 4 * spb + 0.35;
      for (let i = 4; i > 0; i--) tick(songStart - i * spb, i === 1);
      if (schedTimer) clearInterval(schedTimer);
      schedTimer = null;
      stopAudio();
      if (buffer) {
        srcNode = ctxA!.createBufferSource();
        srcNode.buffer = buffer;
        srcNode.connect(ctxA!.destination);
        srcNode.start(songStart);
      } else {
        schedBeat = 0;
        schedTimer = setInterval(scheduler, 25);
      }
      state = "count";
      scrTitle.classList.add("hidden");
      scrResults.classList.add("hidden");
      hud.classList.add("on");
      flashEl.classList.remove("on");
      void flashEl.offsetWidth;
      flashEl.classList.add("on");
    }

    async function startGame() {
      if (starting) return;
      initAudio();
      ctxA!.resume();
      const s = selRef.current;

      if (s.kind === "synth") {
        beginPlay(buildChart(), SPB, TOTAL_BEATS * SPB + 1.0, null);
        return;
      }
      const song = songsRef.current.find((x) => x.slug === s.slug);
      const chart = song?.charts[s.chartIdx];
      if (!song || !chart) return;
      starting = true;
      setLoading(true);
      try {
        let buf = audioCache.get(song.slug);
        if (!buf) {
          const raw = await fetch(`${BASE}/songs/${song.slug}/audio.mp3`).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.arrayBuffer();
          });
          buf = await ctxA!.decodeAudioData(raw);
          audioCache.set(song.slug, buf);
        }
        const trackNotes: Note[] = chart.notes.map(([t, lane, d]) => ({
          t,
          lane,
          d: d ?? 0,
          judged: false,
          res: null,
          holdEnd: null,
          releasedAt: null,
          awarded: 0,
        }));
        beginPlay(trackNotes, 60 / chart.bpm, Math.min(chart.duration, buf.duration + 0.5), buf);
      } catch {
        // áudio indisponível — volta pra tela de título sem travar
      } finally {
        starting = false;
        setLoading(false);
      }
    }

    function toTitle() {
      state = "title";
      stopAudio();
      scrResults.classList.add("hidden");
      scrTitle.classList.remove("hidden");
    }
    apiRef.current = { start: () => void startGame(), toTitle };

    function songNow() {
      return ctxA ? ctxA.currentTime - songStart : -99;
    }

    // janelas de judgment em segundos, lidas do store a cada uso (AST-132 —
    // mudar na tela de título vale já na próxima nota, sem reiniciar)
    function win() {
      const tn = tuningRef.current;
      return {
        perfect: tn.perfectMs / 1000,
        great: tn.greatMs / 1000,
        good: tn.goodMs / 1000,
      };
    }

    function judge(lane: number) {
      const now = songNow();
      const W_ = win();
      laneFlash[lane] = 1;
      let best: Note | null = null,
        bestD = 1e9;
      for (const n of notes) {
        if (n.judged || n.lane !== lane) continue;
        const d = n.t - now;
        if (d > W_.good) break;
        const ad = Math.abs(d);
        if (ad <= W_.good && ad < bestD) {
          best = n;
          bestD = ad;
        }
      }
      if (!best) return;
      best.judged = true;
      let res: JudgeRes, pts: number;
      if (bestD <= W_.perfect) {
        res = "perfect";
        pts = 100;
      } else if (bestD <= W_.great) {
        res = "great";
        pts = 70;
      } else {
        res = "good";
        pts = 40;
      }
      best.res = res;
      stats[res]++;
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      // guarda o que creditou: derrubar o hold depois estorna isso (ver frame())
      best.awarded = pts + Math.min(combo, 50);
      score += best.awarded;
      showJudge(res);
    }
    function miss(n: Note) {
      n.judged = true;
      n.res = "miss";
      if (n.d > 0) n.holdEnd = "ng"; // cabeça perdida derruba o hold inteiro
      stats.miss++;
      combo = 0;
      showJudge("miss");
    }
    function showJudge(res: JudgeRes) {
      judgeFx = { text: JTXT[res], color: JCOL[res], t: songNow() };
    }

    function laneOf(e: KeyboardEvent): number | undefined {
      return e.code in LANE_CODES ? LANE_CODES[e.code] : LANE_KEYS[e.key.toLowerCase()];
    }
    function releaseLane(lane: number) {
      laneHeld[lane] = Math.max(0, laneHeld[lane] - 1);
    }
    // AST-132: a tela de título agora tem campos de texto (AV e janelas). Sem
    // isso, digitar "s" tentaria julgar a pista central, espaço/enter iniciaria
    // a partida e o preventDefault comeria a tecla — era parte do "não dá pra
    // digitar livremente" do relato.
    function isTyping(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.repeat || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      const lane = laneOf(e);
      // laneHeld acompanha o teclado mesmo fora do "play" pra não dessincronizar
      if (lane !== undefined) laneHeld[lane]++;
      if (state === "title" && (k === " " || k === "enter")) {
        void startGame();
        return;
      }
      if (state !== "play" && state !== "count") return;
      if (lane !== undefined) {
        e.preventDefault();
        judge(lane);
      }
    }
    function onKeyup(e: KeyboardEvent) {
      const lane = laneOf(e);
      if (lane !== undefined) releaseLane(lane);
    }
    const touchLanes = new Map<number, number>(); // touch id -> pista segurada
    function onTouchStart(e: TouchEvent) {
      if (state !== "play" && state !== "count") return;
      e.preventDefault();
      const { colW, x0 } = layout();
      for (const t of Array.from(e.changedTouches)) {
        if (tuningRef.current.scrollUp ? t.clientY > H * 0.55 : t.clientY < H * 0.45) continue;
        const lane = Math.floor((t.clientX - x0) / colW);
        if (lane >= 0 && lane < LANES) {
          touchLanes.set(t.identifier, lane);
          laneHeld[lane]++;
          judge(lane);
        }
      }
    }
    function onTouchEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const lane = touchLanes.get(t.identifier);
        if (lane === undefined) continue;
        touchLanes.delete(t.identifier);
        releaseLane(lane);
      }
    }
    let mouseLane = -1;
    function onMouseDown(e: MouseEvent) {
      if (state !== "play" && state !== "count") return;
      const { colW, x0 } = layout();
      if (tuningRef.current.scrollUp ? e.clientY > H * 0.55 : e.clientY < H * 0.45) return;
      const lane = Math.floor((e.clientX - x0) / colW);
      if (lane >= 0 && lane < LANES) {
        mouseLane = lane;
        laneHeld[lane]++;
        judge(lane);
      }
    }
    function onMouseUp() {
      if (mouseLane >= 0) {
        releaseLane(mouseLane);
        mouseLane = -1;
      }
    }
    // Trocar de aba/janela come o keyup, e a pista ficaria "segurada" pra
    // sempre — o que completaria sozinho todos os holds seguintes dela.
    function onBlur() {
      laneHeld.fill(0);
      touchLanes.clear();
      mouseLane = -1;
    }
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("keyup", onKeyup);
    cv.addEventListener("touchstart", onTouchStart, { passive: false });
    cv.addEventListener("touchend", onTouchEnd);
    cv.addEventListener("touchcancel", onTouchEnd);
    cv.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    function arrowPath(size: number) {
      const s = size / 2;
      g!.beginPath();
      g!.moveTo(0, -s);
      g!.lineTo(s * 0.82, s * 0.3);
      g!.lineTo(s * 0.3, s * 0.3);
      g!.lineTo(s * 0.3, s);
      g!.lineTo(-s * 0.3, s);
      g!.lineTo(-s * 0.3, s * 0.3);
      g!.lineTo(-s * 0.82, s * 0.3);
      g!.closePath();
    }
    function diamondPath(size: number) {
      const s = size / 2;
      g!.beginPath();
      g!.moveTo(0, -s);
      g!.lineTo(s * 0.72, 0);
      g!.lineTo(0, s);
      g!.lineTo(-s * 0.72, 0);
      g!.closePath();
    }
    function drawPanel(
      x: number,
      y: number,
      lane: number,
      size: number,
      mode: "note" | "receptor",
      alpha: number
    ) {
      g!.save();
      g!.translate(x, y);
      g!.rotate((LANE_ROT[lane] * Math.PI) / 180);
      g!.globalAlpha = alpha;
      const col = LANE_COLOR[lane];
      if (lane === 2) diamondPath(size);
      else arrowPath(size);
      if (mode === "note") {
        g!.shadowColor = col;
        g!.shadowBlur = 16;
        g!.fillStyle = col;
        g!.fill();
        g!.shadowBlur = 0;
        g!.lineWidth = 1.5;
        g!.strokeStyle = "rgba(11,15,19,.55)";
        g!.stroke();
      } else {
        g!.lineWidth = 2;
        g!.strokeStyle = col;
        g!.stroke();
        if (laneFlash[lane] > 0.02) {
          g!.globalAlpha = alpha * laneFlash[lane] * 0.5;
          g!.fillStyle = col;
          g!.fill();
        }
      }
      g!.restore();
    }

    function drawBackground(now: number) {
      g!.fillStyle = BG; // --bg do design system (near-black aquecido)
      g!.fillRect(0, 0, W, H);
      g!.save();
      g!.globalAlpha = 0.16;
      const rows = 5;
      for (let r = 0; r < rows; r++) {
        const yBase = H * 0.62 + r * (H * 0.075);
        g!.beginPath();
        for (let x = 0; x <= W; x += 14) {
          const y =
            yBase +
            Math.sin(x * 0.012 + r * 1.7 + now * 0.35) * 9 +
            Math.sin(x * 0.004 - r + now * 0.12) * 16;
          if (x === 0) g!.moveTo(x, y);
          else g!.lineTo(x, y);
        }
        g!.strokeStyle = r === 2 ? GAU.amber : "#4a4034";
        g!.lineWidth = r === 2 ? 1.2 : 1;
        g!.stroke();
      }
      g!.restore();
    }

    function fmtTC(sec: number) {
      if (sec < 0) sec = 0;
      const m = Math.floor(sec / 60),
        s = Math.floor(sec % 60),
        f = Math.floor((sec % 1) * 30);
      const p = (v: number) => String(v).padStart(2, "0");
      return `00:${p(m)}:${p(s)}:${p(f)}`;
    }

    function endGame() {
      state = "results";
      if (schedTimer) clearInterval(schedTimer);
      stopAudio();
      hud.classList.remove("on");
      const total = notes.length;
      const acc =
        total > 0
          ? (stats.perfect * 100 + stats.great * 70 + stats.good * 40) / (total * 100)
          : 0;
      let grade = "C";
      if (stats.miss === 0 && acc >= 0.95) grade = "SS";
      else if (acc >= 0.9) grade = "S";
      else if (acc >= 0.75) grade = "A";
      else if (acc >= 0.55) grade = "B";
      gv.textContent = grade;
      gv.style.color =
        grade === "SS" || grade === "S" ? GAU.amber : grade === "A" ? GAU.sage : "#ede4d3";

      rP.textContent = String(stats.perfect);
      rG.textContent = String(stats.great);
      rO.textContent = String(stats.good);
      rM.textContent = String(stats.miss);
      rC.textContent = String(maxCombo);
      rS.textContent = String(score).padStart(7, "0");
      scrResults.classList.remove("hidden");
    }

    function frame() {
      rafId = requestAnimationFrame(frame);
      const now = ctxA ? songNow() : 0;
      drawBackground(now);
      if (state !== "play" && state !== "count") return;

      const { colW, x0, recY, size } = layout();

      if (now > curDuration) {
        endGame();
        return;
      }
      if (state === "count" && now >= 0) state = "play";

      for (const n of notes) {
        if (!n.judged && now - n.t > win().good) miss(n);
      }

      // Holds ativos (AST-132, estilo Pump — não StepMania): completar o hold
      // não abre popup nenhum, só credita pontos, mantém o combo e acende o
      // receptor. Derrubar transforma a nota inteira em MISS, estornando o que
      // a cabeça tinha creditado — assim cada nota tem exatamente um
      // julgamento, e o placar/precisão da tela de resultado não conta a mesma
      // seta duas vezes.
      for (const n of notes) {
        if (n.d <= 0 || !n.judged || n.res === "miss" || n.holdEnd) continue;
        if (laneHeld[n.lane] > 0) n.releasedAt = null;
        else if (n.releasedAt === null) n.releasedAt = now;
        const end = n.t + n.d;
        const dropAt =
          n.releasedAt === null
            ? Infinity
            : n.releasedAt + tuningRef.current.holdRegrabMs / 1000;
        if (now < end && now < dropAt) continue;
        if (end <= dropAt) {
          n.holdEnd = "ok";
          score += HOLD_OK_PTS;
          combo++;
          maxCombo = Math.max(maxCombo, combo);
          laneFlash[n.lane] = 1;
        } else {
          n.holdEnd = "ng";
          if (n.res) {
            stats[n.res]--;
            score -= n.awarded;
          }
          n.res = "miss";
          stats.miss++;
          combo = 0;
          showJudge("miss");
        }
      }

      g!.save();
      g!.globalAlpha = 0.05;
      g!.strokeStyle = "#ede4d3";
      for (let l = 0; l <= LANES; l++) {
        const x = x0 + l * colW;
        g!.beginPath();
        g!.moveTo(x, 0);
        g!.lineTo(x, H);
        g!.stroke();
      }
      g!.restore();

      for (let l = 0; l < LANES; l++) {
        laneFlash[l] = Math.max(0, laneFlash[l] - 0.08);
        drawPanel(x0 + colW * (l + 0.5), recY[l], l, size, "receptor", 0.85);
      }

      const up = tuningRef.current.scrollUp;
      const travel = up ? H - Math.min(...recY) + 80 : Math.max(...recY) + 80;
      const approach = AV_CALIBRATION / tuningRef.current.av; // tempo na tela constante, indep. do BPM
      const yAt = (lane: number, t: number) =>
        up
          ? recY[lane] + ((t - now) / approach) * travel
          : recY[lane] - ((t - now) / approach) * travel;
      for (const n of notes) {
        if (n.t - now > approach) continue; // ainda não spawnou
        if (n.t + n.d - now < -0.25) continue; // cauda já passou
        if (n.d === 0 && n.judged && n.res !== "miss") continue; // tap acertado some
        if (n.holdEnd === "ok") continue; // hold completo some
        const active = n.d > 0 && n.judged && n.res !== "miss" && !n.holdEnd;
        const fade = n.res === "miss" || n.holdEnd === "ng" ? 0.25 : 1;
        const x = x0 + colW * (n.lane + 0.5);
        // hold sendo segurado: cabeça gruda no receptor e o corpo encolhe
        const headY = active ? recY[n.lane] : yAt(n.lane, n.t);
        if (n.d > 0) {
          const tailY = yAt(n.lane, n.t + n.d);
          g!.save();
          g!.globalAlpha = 0.4 * fade;
          g!.strokeStyle = LANE_COLOR[n.lane];
          g!.lineWidth = size * 0.42;
          g!.lineCap = "round";
          g!.beginPath();
          g!.moveTo(x, headY);
          g!.lineTo(x, tailY);
          g!.stroke();
          g!.restore();
        }
        drawPanel(x, headY, n.lane, size, "note", fade);
      }

      const jAge = now - judgeFx.t;
      if (jAge < 0.6 && judgeFx.text) {
        g!.save();
        g!.textAlign = "center";
        g!.globalAlpha = 1 - Math.max(0, (jAge - 0.3) / 0.3);
        const pop = 1 + Math.max(0, 0.12 - jAge) * 2.5;
        g!.font = `600 ${Math.round(20 * pop)}px ${fontMono}`;
        g!.fillStyle = judgeFx.color;
        g!.shadowColor = judgeFx.color;
        g!.shadowBlur = 12;
        g!.fillText(judgeFx.text, W / 2, H * 0.34);
        g!.restore();
      }
      if (combo >= 4) {
        g!.save();
        g!.textAlign = "center";
        g!.font = `italic 700 34px ${fontDisplay}`;
        g!.fillStyle = "#E8EDF0";
        g!.globalAlpha = 0.9;
        g!.fillText(String(combo), W / 2, H * 0.42);
        g!.font = `600 10px ${fontMono}`;
        g!.fillStyle = "#7D8A93";
        g!.fillText("C O M B O", W / 2, H * 0.455);
        g!.restore();
      }
      if (state === "count") {
        const beatsLeft = Math.ceil(-now / curSPB);
        g!.save();
        g!.textAlign = "center";
        g!.font = `italic 700 84px ${fontDisplay}`;
        g!.fillStyle = "#DDBC7F";
        g!.shadowColor = "#DDBC7F";
        g!.shadowBlur = 24;
        g!.fillText(beatsLeft > 3 ? "" : String(beatsLeft), W / 2, H * 0.3);
        g!.restore();
      }

      tcv.textContent = fmtTC(now);
      scv.textContent = String(score).padStart(7, "0");
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      if (schedTimer) clearInterval(schedTimer);
      stopAudio();
      apiRef.current = null;
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("keyup", onKeyup);
      cv.removeEventListener("touchstart", onTouchStart);
      cv.removeEventListener("touchend", onTouchEnd);
      cv.removeEventListener("touchcancel", onTouchEnd);
      cv.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      if (ctxA) ctxA.close().catch(() => {});
    };
  }, []);

  const selMeta = (() => {
    if (sel.kind === "song") {
      const song = songs.find((s) => s.slug === sel.slug);
      const chart = song?.charts[sel.chartIdx];
      if (song && chart) {
        const mm = Math.floor(chart.duration / 60);
        const ss = String(Math.floor(chart.duration % 60)).padStart(2, "0");
        return `FAIXA: ${song.title} · ${chart.label} · ${chart.bpm} BPM · ${mm}:${ss}`;
      }
    }
    return "FAIXA: SÍNTESE INTERNA · 128 BPM · 01:04";
  })();

  return (
    <div className="rhythm-root">
      <div id="stage">
        <canvas id="cv" ref={canvasRef} />
      </div>

      <div id="hud">
        <div className="tc">
          <span className="rec">●</span> REC{"  "}TC <span id="tcv">00:00:00:00</span>
        </div>
        <div className="sc">
          <small>SCORE</small>
          <span id="scv">0000000</span>
        </div>
      </div>

      <div className="screen" id="scr-title">
        <div className="meta">
          GAUCHONES ▸ SIDE B <b>{"//"}</b> DEMO_01
        </div>
        <h1>
          <span className="gr">RHYTHM</span>
          <br />
          CHECK
        </h1>
        <div className="stripe title-stripe">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div className="howto">
          <div>
            <div className="pad">
              <span className="k s">Q</span>
              <span className="k e"></span>
              <span className="k s">E</span>
              <span className="k e"></span>
              <span className="k c">S</span>
              <span className="k e"></span>
              <span className="k r">Z</span>
              <span className="k e"></span>
              <span className="k r">C</span>
            </div>
            TECLADO
          </div>
          <div style={{ maxWidth: 180, lineHeight: 1.9 }}>
            NO CELULAR, TOQUE NOS
            <br />
            PAINÉIS QUANDO A SETA
            <br />
            CHEGAR NA BASE
          </div>
        </div>
        <div className="tracks">
          <button
            className={`ghost${sel.kind === "synth" ? " sel" : ""}`}
            onClick={() => choose({ kind: "synth" })}
          >
            Demo · Síntese
          </button>
          {songs.map((song) => (
            <div className="song" key={song.slug}>
              <span className="song-name">
                {song.title}
                {song.artist ? ` — ${song.artist}` : ""}
              </span>
              <div className="diffs">
                {song.charts.map((c, i) => (
                  <button
                    key={`${c.label}-${i}`}
                    className={`ghost${
                      sel.kind === "song" && sel.slug === song.slug && sel.chartIdx === i
                        ? " sel"
                        : ""
                    }`}
                    onClick={() => choose({ kind: "song", slug: song.slug, chartIdx: i })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <TuningPanel tuning={tuning} />
        <button
          className="start"
          onClick={() => apiRef.current?.start()}
          disabled={loading}
        >
          {loading ? "Carregando…" : "Iniciar"}
        </button>
        <div className="meta">{selMeta}</div>
      </div>

      <div className="screen hidden" id="scr-results">
        <div className="meta">
          PLAYBACK COMPLETO <b>{"//"}</b> RESULTADO
        </div>
        <div className="grade" id="gradev">
          A
        </div>
        <div className="stripe title-stripe">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div className="stats">
          <div className="row p">
            <span>Perfect</span>
            <b id="r-p">0</b>
          </div>
          <div className="row g">
            <span>Great</span>
            <b id="r-g">0</b>
          </div>
          <div className="row">
            <span>Good</span>
            <b id="r-o">0</b>
          </div>
          <div className="row o">
            <span>Miss</span>
            <b id="r-m">0</b>
          </div>
          <div className="row">
            <span>Combo máx</span>
            <b id="r-c">0</b>
          </div>
          <div className="row">
            <span>Score</span>
            <b id="r-s">0</b>
          </div>
        </div>
        <button className="start" onClick={() => apiRef.current?.start()}>
          Jogar de novo
        </button>
        <button className="ghost" onClick={() => apiRef.current?.toTitle()}>
          Voltar ao início
        </button>
      </div>

      <div className="crt"></div>
      <div className="flash" id="flash"></div>
    </div>
  );
}
