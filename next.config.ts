import type { NextConfig } from "next";

/*
 * Export estático: o jogo é 100% client-side (canvas + WebAudio, sem servidor,
 * sem banco), então `output: "export"` gera HTML puro que o GitHub Pages serve
 * direto — mesma URL que o repo já tinha antes de virar app Next.
 *
 * O Pages publica em isakurtz.github.io/gauchones-rhythm, ou seja, sob um
 * subcaminho. basePath resolve isso pros assets do Next, mas NÃO para o
 * fetch() das músicas — por isso NEXT_PUBLIC_BASE_PATH também é lido em
 * RhythmGame.tsx. As duas variáveis saem da mesma env no workflow.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // sem servidor não há otimização de imagem sob demanda
  images: { unoptimized: true },
  // Pages serve /rota/ como /rota/index.html
  trailingSlash: true,
};

export default nextConfig;
