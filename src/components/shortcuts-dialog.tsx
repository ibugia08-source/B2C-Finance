"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortcutMap, visibleCommands } from "@/lib/commands";
import { Kbd } from "./command-palette";
import type { UserLike } from "./nav-items";

/**
 * MAPA DE ATALHOS (tecla ?) — 02 §3 exige que ele seja "gerado do
 * registro real de comandos". É literalmente isso: a lista abaixo sai de
 * shortcutMap(visibleCommands(user)), então um atalho que deixe de
 * existir some daqui sozinho e um que nasça aparece sem ninguém lembrar
 * de editar a documentação. Nada é escrito à mão.
 *
 * Só aparecem os atalhos que ESTE usuário pode usar: o registro já
 * filtra por permissão.
 */
export function ShortcutsDialog({ user }: { user: UserLike }) {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener("b2c:shortcuts", abrir);
    return () => window.removeEventListener("b2c:shortcuts", abrir);
  }, []);

  if (!user) return null;
  const comandos = shortcutMap(visibleCommands(user));
  const porGrupo = new Map<string, typeof comandos>();
  for (const c of comandos) {
    porGrupo.set(c.group, [...(porGrupo.get(c.group) ?? []), c]);
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Grupo titulo="Sempre disponível">
            <Linha teclas="Ctrl K" descricao="Abrir busca e comandos" />
            <Linha teclas="/" descricao="Buscar" />
            <Linha teclas="?" descricao="Este mapa" />
            <Linha teclas="u" descricao="Desfazer o último gesto" />
            <Linha teclas="[ ]" descricao="Mês anterior e seguinte" />
            <Linha teclas="t" descricao="Voltar ao mês atual" />
          </Grupo>

          {/* 02 §3: as teclas de tabela são fixas por definição — elas não
              são comandos do registro, são o comportamento do gabarito
              "planilha viva". Ficam escritas aqui porque é aqui que quem
              nunca usou vai procurar. */}
          <Grupo titulo="Dentro de uma tabela">
            <Linha teclas="↑ ↓" descricao="Navegar entre as linhas" />
            <Linha teclas="Enter" descricao="Abrir o item da linha" />
            <Linha teclas="Espaço" descricao="Selecionar a linha" />
            <Linha teclas="p" descricao="Registrar pagamento na linha" />
          </Grupo>

          <Grupo titulo="No Modo Fila">
            <Linha teclas="j k" descricao="Próximo e anterior" />
            <Linha teclas="Enter" descricao="Ação principal da trilha" />
            <Linha teclas="s" descricao="Pular sem resolver" />
            <Linha teclas="p" descricao="Registrar promessa" />
            <Linha teclas="1 2 3" descricao="Trocar de trilha" />
          </Grupo>

          {[...porGrupo.entries()].map(([grupo, cmds]) => (
            <Grupo key={grupo} titulo={grupo}>
              {cmds.map((c) => (
                <Linha key={c.id} teclas={c.shortcut!} descricao={c.label} />
              ))}
            </Grupo>
          ))}
        </div>

        <p className="text-caption text-muted-foreground">
          Os atalhos não funcionam enquanto você digita em um campo.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Linha({ teclas, descricao }: { teclas: string; descricao: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-body">
      <span className="text-foreground">{descricao}</span>
      <span className="flex shrink-0 items-center gap-1">
        {teclas.split(" ").map((t, i) => (
          <Kbd key={i}>{t}</Kbd>
        ))}
      </span>
    </div>
  );
}
