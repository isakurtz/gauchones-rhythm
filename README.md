# Gauchones ▸ Rhythm Check

Versão standalone do minigame de ritmo do [Gauchones](https://gauchones.com),
estilo Pump It Up (5 painéis). Roda no navegador, sem conta e sem servidor.

Demo: https://isakurtz.github.io/gauchones-rhythm/

## O que é

Este repo é um espelho jogável do minigame que vive em `/jogo` no site. No site
ele é uma tela a mais, atrás de login; aqui ele é o produto inteiro.

Diferenças em relação ao site, por serem dependentes de conta e banco:

- **sem sorteio de brinde** (a "seta premiada");
- **sem ranking** (nem consulta nem salvar pontuação).

O resto é o mesmo código: paleta e tipografia do design system, stage em linha
reta, judgment de hold no modelo Pump (hold completo sem popup, derrubar vira
MISS e estorna a cabeça) e o painel de **Ajustes** na tela de título — AV,
direção do scroll e janelas de judgment, persistidos em `localStorage`.

## Controles

- **Teclado**: `Q` `E` `S` `Z` `C`, ou o numpad espelhando o pad (`7` `9` `5` `1` `3`).
- **Toque/mouse**: toque na coluna do painel.

## Músicas

`public/songs/<slug>/` traz `chart.json` (notas já em segundos) + `audio.mp3`,
mais o manifesto `index.json`. São gerados no repo principal a partir dos
arquivos `.ssc` do StepMania/StepF2 e copiados pra cá — este repo não tem o
conversor.

Sem `public/songs/` o jogo continua funcionando: cai na demo de síntese, um
chart gerado em código com áudio via WebAudio.

## Desenvolvimento

```bash
npm install
npm run dev     # http://localhost:3000
npm run lint
npm run build   # export estático em out/
```

## Deploy

O build é um **export estático** (`output: "export"` no `next.config.ts`) — o
jogo é 100% client-side, então não precisa de servidor Node. O
`.github/workflows/deploy.yml` builda e publica no GitHub Pages a cada push na
`main`.

> **Atenção na primeira vez:** o Pages deste repo servia o `index.html` que
> ficava na raiz. Agora quem publica é o workflow, então é preciso trocar
> **Settings → Pages → Source** de "Deploy from a branch" para **"GitHub
> Actions"**. Sem isso o Pages tenta servir a raiz do repo, que não tem mais
> `index.html`, e a demo quebra.

O site fica sob `/gauchones-rhythm/`, e é isso que `NEXT_PUBLIC_BASE_PATH`
resolve: o `basePath` do Next cuida dos assets dele, mas `fetch()` não passa
pelo `basePath`, então o caminho das músicas é montado à mão em
`RhythmGame.tsx`. Pra publicar em domínio próprio (na raiz), é só não definir
a variável.
