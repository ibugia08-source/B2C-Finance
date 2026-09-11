import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
} from "@/components/ui/record-card";
import { EstadoDaTela } from "@/components/ui/estado";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { getLiquidez } from "@/lib/services/liquidity";
import { TIPO_DE_CONTA_LABEL } from "@/lib/conta-meta";
import { ContaDialog } from "./conta-dialog";
import { ContaActions } from "./row-actions";

/**
 * CAIXA E CONTAS — UX-01, DA-01 e DA-12 da auditoria de 11/09/2026.
 *
 * Esta rota existia em link e não existia em página: a rotina da semana
 * apontava "Disponível hoje" e "Projeção em 30 dias" para /caixa, e /caixa
 * devolvia "Página não encontrada". Ao mesmo tempo, as contas bancárias eram
 * lidas por dez telas e não tinham nenhuma onde fossem cadastradas — o que
 * fazia o fluxo projetado abrir com saldo inicial zero e o filtro de conta
 * vazio, sem que nada na interface dissesse por quê.
 *
 * A tela responde a três perguntas, nesta ordem:
 *   1. quanto dá para gastar hoje, e do que esse número é feito;
 *   2. onde o caixa chega em 30 dias, linha a linha;
 *   3. de quais contas isso tudo sai.
 *
 * A composição vem do MESMO objeto que o painel usa (projecaoDeCaixa). É o
 * que impede esta página de virar a quarta versão de "projeção 30 dias".
 */
export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const viewer = await requirePagePermission("caixa.visualizar");
  const podeGerenciar = can(viewer, "caixa.gerenciar_contas");

  const [contas, liquidez] = await Promise.all([
    prisma.account.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bank: true,
        type: true,
        balance: true,
        active: true,
      },
    }),
    getLiquidez(new Date().toISOString()),
  ]);

  const ativas = contas.filter((c) => c.active);
  const semContas = ativas.length === 0;
  const proj = liquidez.projecao;

  const paraLinha = (c: (typeof contas)[number]) => ({
    id: c.id,
    name: c.name,
    bank: c.bank,
    type: c.type,
    balance: String(c.balance),
    active: c.active,
  });

  return (
    <div>
      <PageHeader
        title="Caixa e contas"
        description="O dinheiro que existe hoje, onde ele chega em 30 dias e de quais contas ele sai"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/fluxo">
                Fluxo dia a dia <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            {podeGerenciar && <ContaDialog />}
          </>
        }
      />

      {/* ===== 1. Quanto dá para gastar hoje ===== */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Saldo das contas"
          value={semContas ? null : formatBRL(liquidez.contas)}
          nullReason="nenhuma conta ativa cadastrada"
          metrica="caixa_total"
          hint={`${ativas.length} ${ativas.length === 1 ? "conta ativa" : "contas ativas"}`}
        />
        <MetricCard
          title="Compromisso imediato"
          value={semContas ? null : formatBRL(liquidez.compromissos)}
          nullReason="depende das contas cadastradas"
          tone={liquidez.compromissos > 0 ? "warning" : "default"}
          hint={
            liquidez.janelaDias === 0
              ? "contas a pagar já vencidas"
              : `vencidas e vencendo em até ${liquidez.janelaDias} dias`
          }
          help="Conta a pagar que já venceu ou vence dentro da janela configurada. Esse dinheiro tem dono e tem data — por isso sai do disponível."
        />
        <MetricCard
          title="Disponível hoje"
          value={semContas ? null : formatBRL(liquidez.disponivel)}
          nullReason="nenhuma conta ativa cadastrada"
          metrica="liquidez_disponivel"
          tone={liquidez.disponivel > 0 ? "positive" : "negative"}
          hint="saldo das contas menos o compromisso imediato"
        />
        <MetricCard
          title="Projeção em 30 dias"
          value={semContas ? null : formatBRL(liquidez.projecao30d)}
          nullReason="sem saldo de partida"
          metrica="projecao_caixa_horizonte"
          tone={liquidez.projecao30d < 0 ? "negative" : "positive"}
          hint="mesma conta que o painel e a rotina usam"
        />
      </div>

      {/* ===== 2. Do que a projeção é feita ===== */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <h2 className="mb-1 text-emphasis font-semibold">
            Como a projeção de 30 dias foi montada
          </h2>
          <p className="mb-3 text-dense text-muted-foreground">
            Uma linha por parcela do cálculo. Este é o único lugar onde essa
            conta é feita no sistema — painel, rotina e Histórico Anual leem
            daqui, para os quatro nunca discordarem.
          </p>
          <dl className="text-body">
            <LinhaDaConta rotulo="Saldo das contas ativas hoje" valor={proj.partida} />
            <LinhaDaConta
              rotulo="A receber vencendo nos próximos 30 dias"
              valor={proj.aReceber}
              sinal="+"
            />
            <LinhaDaConta
              rotulo="A pagar até 30 dias, incluindo o que já venceu"
              valor={-proj.aPagar}
              sinal="−"
            />
            {proj.passivoFinanciado > 0 && (
              <LinhaDaConta
                rotulo="Parcelas de financiamento no período"
                valor={-proj.passivoFinanciado}
                sinal="−"
              />
            )}
            <LinhaDaConta
              rotulo="Projeção em 30 dias"
              valor={liquidez.projecao30d}
              total
            />
          </dl>

          {proj.aReceberVencido > 0 && (
            <p className="mt-3 rounded-card border border-warning/30 bg-warning-soft px-3 py-2.5 text-dense text-warning-ink">
              <strong className="font-medium">
                Fora da soma: {formatBRL(proj.aReceberVencido)} de cobranças já
                vencidas.
              </strong>{" "}
              Elas não entram como entrada porque já deveriam ter chegado —
              contá-las suporia que o atrasado chega dentro do prazo, que é a
              hipótese mais otimista possível.{" "}
              <Link href="/inadimplencia" className="underline underline-offset-2">
                Ver na inadimplência
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. De quais contas isso sai ===== */}
      <Card>
        <CardContent className="p-0">
          {contas.length === 0 ? (
            <EstadoDaTela
              tipo="nao-configurado"
              titulo="Nenhuma conta cadastrada"
              descricao={
                <>
                  O saldo de partida de toda projeção de caixa vem daqui. Sem
                  nenhuma conta, o fluxo projetado começa do zero — o que não é
                  o mesmo que o caixa estar zerado, e a tela passa a dizer isso.
                </>
              }
              acao={podeGerenciar ? <ContaDialog /> : undefined}
            />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Conta</TableHead>
                      <TableHead>Banco</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead>Situação</TableHead>
                      {podeGerenciar && <TableHead className="w-24" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contas.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <Landmark
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            {c.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.bank ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {TIPO_DE_CONTA_LABEL[c.type] ?? c.type}
                        </TableCell>
                        <TableCell className="stat-number text-right">
                          {formatBRL(c.balance)}
                        </TableCell>
                        <TableCell>
                          {c.active ? (
                            <Badge variant="success">Ativa</Badge>
                          ) : (
                            <Badge variant="secondary">Encerrada</Badge>
                          )}
                        </TableCell>
                        {podeGerenciar && (
                          <TableCell>
                            <ContaActions conta={paraLinha(c)} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <MobileCards>
                {contas.map((c) => (
                  <MobileCard key={c.id}>
                    <MobileCardHeader
                      title={c.name}
                      aside={
                        c.active ? (
                          <Badge variant="success">Ativa</Badge>
                        ) : (
                          <Badge variant="secondary">Encerrada</Badge>
                        )
                      }
                    />
                    <Field label="Saldo">{formatBRL(c.balance)}</Field>
                    <Field label="Banco">{c.bank ?? "—"}</Field>
                    <Field label="Tipo">{TIPO_DE_CONTA_LABEL[c.type] ?? c.type}</Field>
                    {podeGerenciar && (
                      <MobileCardActions>
                        <ContaActions conta={paraLinha(c)} />
                      </MobileCardActions>
                    )}
                  </MobileCard>
                ))}
              </MobileCards>
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-caption text-muted-foreground">
        Conta encerrada fica de fora de todo cálculo de caixa: saldo de conta
        encerrada não é dinheiro. Para tirar uma conta das contas sem perder o
        histórico dela, marque como encerrada em vez de excluir.
      </p>
    </div>
  );
}

/** Uma parcela do cálculo da projeção. Alinhada à direita, mono tabular. */
function LinhaDaConta({
  rotulo,
  valor,
  sinal,
  total,
}: {
  rotulo: string;
  valor: number;
  sinal?: "+" | "−";
  total?: boolean;
}) {
  return (
    <div
      className={
        total
          ? "flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold"
          : "flex items-baseline justify-between gap-3 border-b border-border-soft py-1.5"
      }
    >
      <dt className={total ? "" : "text-muted-foreground"}>{rotulo}</dt>
      <dd
        className={
          "stat-number shrink-0 " +
          (total
            ? valor < 0
              ? "text-danger-ink"
              : "text-success-ink"
            : sinal === "+"
              ? "text-success-ink"
              : sinal === "−"
                ? "text-danger-ink"
                : "")
        }
      >
        {sinal ?? ""}
        {sinal ? " " : ""}
        {formatBRL(Math.abs(valor))}
      </dd>
    </div>
  );
}
