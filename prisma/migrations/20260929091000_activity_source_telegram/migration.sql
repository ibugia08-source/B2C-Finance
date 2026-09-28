-- Telegram como origem na trilha de atividades da API (Fase 16, 29/09/2026).
-- ADITIVA: só um valor novo no enum; nenhum registro existente muda.
ALTER TYPE "ActivitySource" ADD VALUE IF NOT EXISTS 'TELEGRAM';
