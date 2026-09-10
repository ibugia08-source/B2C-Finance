import { AlertTriangle } from "lucide-react";
import { BrandAuthPanel, BrandLogo } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Entrar — B2C Finance",
};

/**
 * ENTRADA DO B2C FINANCE — identidade "Clareza em movimento".
 *
 * Duas colunas de 50% no desktop: à esquerda o painel institucional
 * (logo, mensagem curta e a arte 4:5 do pacote de marca), à direita o
 * formulário em no máximo 420 px. A logo fica FORA da ilustração — a
 * arte tem fundo próprio (#F5F8FC no claro, #0B192B no escuro, os
 * mesmos do canvas), então o painel e o desenho terminam sem emenda.
 *
 * Abaixo de lg o painel some e a ordem vira logo → título → campos →
 * botão. A faixa 3:1 só aparece no tablet (768-1023 px): em 360-390 px
 * qualquer imagem acima dos campos empurra o botão para debaixo do
 * teclado.
 *
 * Sem `h-screen` e sem `overflow-hidden` na coluna que rola: com o
 * teclado aberto, `100svh` encolhe e o conteúdo precisa poder subir. O
 * bloco central usa `my-auto` (e não `items-center`) justamente porque
 * margem automática recentraliza quando cabe e simplesmente flui quando
 * não cabe — centralizar por alinhamento cortaria o topo.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { sessao?: string };
}) {
  const sessaoEncerrada = searchParams?.sessao === "encerrada";

  return (
    <div className="min-h-[100svh] bg-background text-foreground lg:grid lg:grid-cols-2">
      {/* ---------- Painel institucional (desktop) ---------- */}
      <aside className="relative hidden overflow-hidden border-r border-border-soft lg:sticky lg:top-0 lg:flex lg:h-[100svh] lg:flex-col lg:justify-between lg:px-12 lg:py-12">
        <BrandLogo height={40} loading="eager" />

        <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 py-8">
          <div className="max-w-md">
            <p className="text-[32px] font-semibold leading-[1.2] tracking-[-0.02em]">
              Seu financeiro, com clareza
            </p>
            <p className="mt-3 text-emphasis text-muted-foreground">
              Clientes, contratos, cobranças e caixa na mesma visão — do
              recebimento de hoje ao fechamento do mês.
            </p>
          </div>
          <BrandAuthPanel
            variant="desktop"
            className="mx-auto max-h-[42vh] w-full max-w-[460px]"
          />
        </div>

        <p className="text-caption text-muted-foreground">
          Clareza em movimento
        </p>
      </aside>

      {/* ---------- Formulário ---------- */}
      <main className="flex min-h-[100svh] flex-col bg-card lg:min-h-[100svh]">
        <div className="mx-auto my-auto w-full max-w-[420px] px-5 py-10 sm:px-6">
          {/* Faixa 3:1 — só no tablet (768-1023), onde sobra altura, e
              DENTRO do bloco centralizado para não descolar do formulário.
              No celular ela sai inteira: imagem acima dos campos é o que
              empurra o botão para debaixo do teclado. */}
          <div className="mb-8 hidden overflow-hidden rounded-panel md:block lg:hidden">
            {/* A faixa tem fundo próprio (o papel do tema): arredondar é o
                que a transforma em painel em vez de um retângulo colado
                sobre a superfície do formulário. */}
            <BrandAuthPanel variant="mobile" className="aspect-[3/1] w-full" />
          </div>

          {/* O invólucro é que esconde no desktop: BrandLogo usa `dark:` para
              trocar a arte, e um `lg:hidden` na mesma tag brigaria com ele. */}
          <div className="lg:hidden">
            <BrandLogo height={36} loading="eager" />
          </div>

          <h1 className="mt-7 text-page font-semibold lg:mt-0">
            Entrar na sua conta
          </h1>
          <p className="mt-1.5 text-body text-muted-foreground">
            Acesse sua visão financeira com segurança
          </p>

          {sessaoEncerrada && (
            <p
              role="status"
              className="mt-5 flex items-start gap-2.5 rounded-input border border-warning/35 bg-warning-soft px-3.5 py-2.5 text-dense text-warning"
            >
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />
              <span>Sua sessão anterior não vale mais. Entre de novo.</span>
            </p>
          )}

          <div className="mt-7">
            <LoginForm />
          </div>
        </div>

        <footer className="px-5 pb-8 pt-4 text-center text-caption text-muted-foreground sm:px-6">
          B2C Finance · Um produto B2C Gestão
        </footer>
      </main>
    </div>
  );
}
