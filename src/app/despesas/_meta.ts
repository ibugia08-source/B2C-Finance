/**
 * Metadados de despesas compartilhados entre server e client.
 * IMPORTANTE: sem "use client" — server components (page.tsx) precisam
 * acessar estes objetos diretamente; exports de módulos client viram
 * referências opacas no servidor e quebram em runtime.
 */

export { EXPENSE_TYPE_LABEL, RECURRENCE_LABEL } from "@/lib/status-meta";
