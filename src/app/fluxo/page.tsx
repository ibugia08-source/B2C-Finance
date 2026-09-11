import dynamicImport from "next/dynamic";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { SavedViews } from "@/components/saved-views";
import { requirePagePermission } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { escopoAtual } from "@/lib/services/data-scope";
import { filtroLembradoDoFluxo } from "@/lib/actions/fluxo";
import {
  HORIZONTES, HORIZONTE_PADRAO, fluxoProjetado, type Horizonte,
} from "@/lib/services/cash-flow";
import { EstadoDaTela, ValorAusente } from "@/components/ui/estado";
import { FiltrosDoFluxo } from "./filtros";
import { DiasDoFluxo } from "./dias-table";
import { rotuloDoDia } from "./rotulo";

const SaldoChart = dynamicImport(
  () => import("./saldo-chart").then((m) => m.SaldoChart),
  { ssr: false }
);

/**
 * FLUXO DE CAIXA PROJETADO (F3.11 v2 · ref. 01 §7.2; 02 §4.4).
 *
 * A pergunta da tela é uma só: **em que dia o dinheiro acaba, e por causa de
 * quê?** Por isso ela abre com o horizonte na mão de quem lê (7/15/30 ou
 * intervalo livre), mostra a curva do saldo dia a dia e deixa cada dia ABRIR
 * com os lançamentos que o compõem.
 *
 * O que saiu da tela antiga: as reservas (não existem mais) e tudo que
 * dependia da conciliação. O saldo de partida é o das contas ATIVAS, que é o
 * dinheiro que existe.
 *
 * NENHUMA ESCRITA no caminho de leitura: a única gravação da tela é a
 * preferência de filtro, disparada pelo cliente DEPOIS da navegação.
 */
export const dynamic = "force-dynamic";

type Params = {
  h?: string;
  de?: string;
  ate?: string;
  conta?: string;
  agencia?: string;
};

/** Meia-noite UTC: as datas do banco são ancoradas em UTC (F0.4). */
function hojeUTC(): Date {
  const a = new Date();
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
}

function dataDaUrl(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function FluxoPage({
  searchParams,
}: {
  searchParams?: Params;
}) {
  await requirePagePermission("caixa.visualizar");

  // Sem filtro na URL, a tela abre onde a pessoa parou (SavedView).
  let params = searchParams ?? {};
  if (!params.h && !params.de && !params.conta && !params.agencia) {
    const lembrado = await filtroLembradoDoFluxo();
    if (lembrado) {
      const p = new URLSearchParams(lembrado);
      params = {
        h: p.get("h") ?? undefined,
        de: p.get("de") ?? undefined,
        ate: p.get("ate") ?? undefined,
        conta: p.get("conta") ?? undefined,
        agencia: p.get("agencia") ?? undefined,
      };
    }
  }

  const hoje = hojeUTC();
  const personalizado = params.h === "custom";
  const horizonte: Horizonte = HORIZONTES.includes(Number(params.h) as Horizonte)
    ? (Number(params.h) as Horizonte)
    : HORIZONTE_PADRAO;

  const deLivre = dataDaUrl(params.de);
  const ateLivre = dataDaUrl(params.ate);
  const de = personalizado ? (deLivre ?? hoje) : hoje;
  const ateBruto = personalizado
    ? (ateLivre ?? new Date(hoje.getTime() + HORIZONTE_PADRAO * 86_400_000))
    : new Date(hoje.getTime() + (horizonte - 1) * 86_400_000);
  // De/até invertidos não são erro do usuário para punir com tela vazia.
  const ate = ateBruto < de ? de : ateBruto;

  const escopo = await escopoAtual();
  const [contas, agencias] = await Promise.all([
    prisma.account.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    escopo.kind === "AGENCY"
      ? Promise.resolve([])
      : prisma.agency.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
  ]);

  const f = await fluxoProjetado({
    de,
    ate,
    accountId: params.conta || null,
    agencyId: params.agencia || null,
  });

  // DA-02/DA-12: "nenhuma conta ativa" e "contas somando zero" são estados
  // diferentes, e só o primeiro é falta de configuração.
  const semContas = f.contas.length === 0;

  const serie = f.dias.map((d) => ({
    dia: d.dia,
    rotulo: rotuloDoDia(d.dia),
    saldo: d.saldoAcumulado,
  }));

  const diasNoPeriodo = f.dias.length;

  return (
    <div>
      <PageHeader
        title="Fluxo de caixa"
        description="Por data de vencimento — o que entra, o que sai e em que dia o saldo vira"
      />

      <FiltrosDoFluxo
        horizonte={personalizado ? "custom" : (String(horizonte) as "7" | "15" | "30")}
        de={iso(de)}
        ate={iso(ate)}
        contaId={params.conta ?? ""}
        agenciaId={params.agencia ?? ""}
        contas={contas.map((c) => ({ id: c.id, nome: c.name }))}
        agencias={agencias.map((a) => ({ id: a.id, nome: a.name }))}
      />

      <div className="mb-3">
        <SavedViews module="fluxo" />
      </div>

      {f.primeiroDiaNegativo ? (
        <Card className="mb-4 border-destructive">
          <CardContent className="p-4">
            <p className="text-body font-medium text-destructive">
              O saldo projetado fica negativo em{" "}
              {rotuloDoDia(f.primeiroDiaNegativo.dia)}: {formatBRL(f.primeiroDiaNegativo.saldo)}.
            </p>
            <p className="mt-1 text-dense text-muted-foreground">
              Decidir agora o que adiar, antecipar ou cobrar — depois de a conta
              estourar, as opções são piores e mais caras. Abra o dia na tabela
              para ver o que o compõe.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* DA-12: sem nenhuma conta ativa, o saldo de partida é DESCONHECIDO,
          não zero — e a projeção inteira nasce dessa partida. Dizer isso
          antes dos números evita ler "R$ 0,00" como "caixa zerado". */}
      {semContas ? (
        <Card className="mb-4 border-warning/40">
          <CardContent className="p-0">
            <EstadoDaTela
              tipo="nao-configurado"
              titulo="Nenhuma conta cadastrada — a projeção não tem de onde partir"
              descricao={
                <>
                  O saldo de partida vem das contas bancárias ativas. Sem
                  nenhuma, a curva abaixo começa do zero, o que não é o mesmo
                  que o caixa estar zerado: é o saldo não estar configurado.
                  As entradas e saídas previstas continuam válidas.
                </>
              }
              acaoHref="/caixa"
              acaoLabel="Cadastrar contas"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Saldo hoje"
          value={semContas ? null : formatBRL(f.saldoInicial)}
          nullReason="nenhuma conta cadastrada"
          metrica="caixa_total"
          hint={
            params.conta
              ? contas.find((c) => c.id === params.conta)?.name
              : `${f.contas.length} ${f.contas.length === 1 ? "conta ativa" : "contas ativas"}`
          }
          help="Soma dos saldos das contas bancárias ativas — o ponto de partida da projeção. Conta inativa fica de fora: saldo de conta encerrada não é dinheiro."
        />
        <MetricCard
          title="Entradas previstas"
          value={formatBRL(f.totalEntradas)}
          basis="caixa"
          tone="positive"
          hint={`${diasNoPeriodo} ${diasNoPeriodo === 1 ? "dia" : "dias"} no período`}
          help="Cobranças em aberto com vencimento dentro do período, pelo saldo (valor menos o que já foi recebido). As vencidas que caem na janela aparecem marcadas."
        />
        <MetricCard
          title="Saídas previstas"
          value={formatBRL(f.totalSaidas)}
          basis="caixa"
          tone="negative"
          help="Despesas não pagas e faturas de cartão com vencimento no período, mais a folha aprovada cujo pagamento cai na janela. A compra do cartão não é contada junto com a fatura dela."
        />
        <MetricCard
          title="Saldo ao fim do período"
          value={formatBRL(f.saldoFinal)}
          basis="caixa"
          tone={f.saldoFinal < 0 ? "negative" : "positive"}
          hint={`${iso(de).split("-").reverse().slice(0, 2).join("/")} a ${iso(ate).split("-").reverse().slice(0, 2).join("/")}`}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Saldo projetado dia a dia
          </p>
          <SaldoChart dados={serie} primeiroNegativo={f.primeiroDiaNegativo} />
        </CardContent>
      </Card>

      <DiasDoFluxo dias={f.dias} saldoInicial={f.saldoInicial} />

      {f.truncado ? (
        <p className="mt-3 text-dense text-warning">
          O período escolhido tem lançamentos demais para uma leitura só — a
          tabela mostra os primeiros. Estreite o horizonte para ver a conta
          fechada.
        </p>
      ) : null}
      <p className="mt-3 text-dense text-muted-foreground">
        As entradas não escolhem conta: cobrança não define em qual banco o
        dinheiro cai antes de cair. Por isso o filtro por conta aperta o saldo
        de partida e as saídas endereçadas, e mantém as entradas no
        consolidado — distribuí-las por conta seria inventar um número.
      </p>
      <p className="mt-1.5 text-dense text-muted-foreground">{f.aviso}</p>
    </div>
  );
}
