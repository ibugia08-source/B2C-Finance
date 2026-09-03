/**
 * Dados base do seed — compartilhados entre o seed COMPLETO (seed.ts, com
 * pessoas e cartões de exemplo) e o seed de DESENVOLVIMENTO (seed-dev.ts,
 * só configuração). Fonte única: mudar aqui vale para os dois.
 */

export const CATEGORIES = [
  { name: "Pessoal", kind: "despesa", color: "#3b82f6" },
  { name: "Empresa", kind: "despesa", color: "#10b981" },
  { name: "Família", kind: "despesa", color: "#f59e0b" },
  { name: "Terceiros", kind: "despesa", color: "#a855f7" },
  { name: "Carro", kind: "despesa", color: "#ef4444" },
  { name: "Cabelo/Estética", kind: "despesa", color: "#ec4899" },
  { name: "Luz/Água", kind: "despesa", color: "#06b6d4" },
  { name: "Tráfego Pago", kind: "despesa", color: "#8b5cf6" },
  { name: "Ferramentas", kind: "despesa", color: "#64748b" },
  { name: "Alimentação", kind: "despesa", color: "#f97316" },
  { name: "Transporte", kind: "despesa", color: "#14b8a6" },
  { name: "Lazer", kind: "despesa", color: "#eab308" },
  { name: "Reserva de Emergência", kind: "mista", color: "#22c55e" },
  { name: "Investimentos", kind: "mista", color: "#16a34a" },
  { name: "Reembolsável", kind: "despesa", color: "#0ea5e9" },
  { name: "Dívida a Receber", kind: "despesa", color: "#dc2626" },
];
export const RULES = [
  {
    name: "Tráfego Pago - META/ADS",
    priority: 10,
    descriptionContains: "META",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Tráfego Pago - Facebook",
    priority: 10,
    descriptionContains: "FACEBOOK",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Tráfego Pago - Google",
    priority: 10,
    descriptionContains: "GOOGLE",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Tráfego Pago - ADS",
    priority: 10,
    descriptionContains: "ADS",
    categoryName: "Tráfego Pago",
    belongsTo: "empresa",
  },
  {
    name: "Transporte - Uber",
    priority: 20,
    descriptionContains: "UBER",
    categoryName: "Transporte",
    belongsTo: "pessoal",
  },
  {
    name: "Carro - Posto",
    priority: 20,
    descriptionContains: "POSTO",
    categoryName: "Carro",
    belongsTo: "pessoal",
  },
  {
    name: "Luz/Água - COELBA",
    priority: 15,
    descriptionContains: "COELBA",
    categoryName: "Luz/Água",
    belongsTo: "pessoal",
  },
  {
    name: "Luz/Água - EMBASA",
    priority: 15,
    descriptionContains: "EMBASA",
    categoryName: "Luz/Água",
    belongsTo: "pessoal",
  },
];
