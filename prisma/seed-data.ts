/**
 * Dados base do seed — compartilhados entre o seed COMPLETO (seed.ts, com
 * pessoas e cartões de exemplo) e o seed de DESENVOLVIMENTO (seed-dev.ts,
 * só configuração). Fonte única: mudar aqui vale para os dois.
 */

export const PEOPLE = [
  { name: "Israel", type: "pessoal" },
  { name: "Isis", type: "familiar" },
  { name: "Esaú", type: "familiar" },
  { name: "Pai", type: "familiar" },
  { name: "Empresa / Agência", type: "empresa" },
  { name: "Terceiro", type: "terceiro" },
];
export const CARDS = [
  { name: "Nubank Israel", bank: "Nubank", type: "pessoal", holder: "Israel", limitTotal: 5000, closingDay: 17, dueDay: 25 },
  { name: "Inter Israel", bank: "Inter", type: "pessoal", holder: "Israel", limitTotal: 3000, closingDay: 5, dueDay: 12 },
  { name: "C6 Bank", bank: "C6", type: "pessoal", holder: "Israel", limitTotal: 2000, closingDay: 10, dueDay: 18 },
  { name: "Will", bank: "Will Bank", type: "pessoal", holder: "Israel", limitTotal: 1500, closingDay: 20, dueDay: 28 },
  { name: "Magalu Esaú", bank: "Itaú", type: "terceiro", holder: "Esaú", limitTotal: 1000, closingDay: 1, dueDay: 8 },
  { name: "Magalu Israel", bank: "Itaú", type: "pessoal", holder: "Israel", limitTotal: 1500, closingDay: 1, dueDay: 8 },
  { name: "PicPay", bank: "PicPay", type: "pessoal", holder: "Israel", limitTotal: 800, closingDay: 22, dueDay: 30 },
  { name: "Sicredi", bank: "Sicredi", type: "pessoal", holder: "Israel", limitTotal: 2500, closingDay: 15, dueDay: 22 },
  { name: "Cartão do Pai", bank: "Bradesco", type: "terceiro", holder: "Pai", limitTotal: 4000, closingDay: 8, dueDay: 15 },
];
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
