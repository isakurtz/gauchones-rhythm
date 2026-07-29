import type { Metadata, Viewport } from "next";
import { Saira_Condensed, Source_Code_Pro } from "next/font/google";
import "./globals.css";

// Mesmas fontes do site (AST-130). Source Code Pro é a do corpo; Saira
// Condensed é a stand-in gratuita da Industry Demi Italic.
const sourceCodePro = Source_Code_Pro({
  variable: "--font-scp",
  subsets: ["latin"],
});

const displayFont = Saira_Condensed({
  variable: "--font-saira",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Gauchones ▸ Rhythm Check",
  description:
    "Demo do minigame de ritmo inspirado em Pump It Up, feito para o Gauchones.",
};

// o jogo é tela cheia e depende de toque; zoom por pinça atrapalha os painéis
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${sourceCodePro.variable} ${displayFont.variable}`}>
      <head>
        {/*
         * Industry Demi/Bold Italic (kit Adobe Fonts da Isa). O kit é liberado
         * por domínio: se isakurtz.github.io não estiver na lista, a fonte
         * simplesmente não carrega e o stack cai na Saira Condensed — que é
         * exatamente o fallback declarado em --rhythm-display.
         */}
        <link rel="stylesheet" href="https://use.typekit.net/cjv7mfl.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
