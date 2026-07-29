// Recorte do design system do site (gauchones/src/lib/design.ts). Aqui só a
// paleta é usada: o jogo desenha no canvas, que não lê variável CSS, então
// precisa dos hex em JS. Os helpers de classe do original ficaram de fora —
// este repo não usa Tailwind.
//
// Paleta (decisão da Isa): âmbar = ação primária + intermediate; sage =
// advanced; rosé = experts e cor "da marca" das setas.
export const GAU = {
  amber: "#f0b64f",
  sage: "#6ec49a",
  rose: "#e8607e",
} as const;
