/**
 * DATASET DE ESTRESSE DOS RELATÓRIOS (teste 12 da auditoria de 10/09/2026).
 *
 * "Dataset com 0, 1, 8, 9 e 120+ registros; nomes longos, acentos, valores
 * negativos e descrições extensas. Nenhuma linha desaparece por
 * paginação/rolagem."
 *
 * Os cinco tamanhos não são decoração: cada um pega uma classe de defeito
 * diferente na exportação.
 *
 *   0    → o documento vazio precisa DIZER que está vazio, não sair em branco
 *   1    → uma linha só não pode virar página órfã com o rodapé
 *   8/9  → o limiar do "Top 8" e a primeira quebra de página
 *   130  → paginação de verdade, com cabeçalho repetido em toda folha
 *
 * Os tamanhos ficam separados por STATUS do cliente, e não por sorte: o
 * verificador filtra por status e sabe exatamente quantas linhas tem de
 * encontrar. Um teste que conta "umas cento e tantas" não prova nada.
 *
 * SÓ RODA CONTRA O BANCO LOCAL. É semente de laboratório: nomes com acento,
 * nome de 90 caracteres, descrição longa e despesa negativa (estorno) — o
 * conteúdo que quebra layout, que é exatamente o que se quer exercitar.
 *
 *   npx tsx scripts/semear-relatorios-estresse.ts [--limpar]
 */
import { loadEnv } from "./env";
loadEnv();

const url = process.env.POSTGRES_PRISMA_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("✖ Semente de laboratório: só roda no banco LOCAL.");
  process.exit(1);
}

/** Marca no nome: é assim que a limpeza sabe o que é dela. */
export const MARCA = "[ESTRESSE]";

const NOME_LONGO =
  "COMÉRCIO E DISTRIBUIÇÃO DE MATERIAIS DE CONSTRUÇÃO SÃO SEBASTIÃO DO PARAÍSO LTDA ME";

/**
 * Cada tamanho ganha um RESPONSÁVEL próprio, e é por ele que o verificador
 * recorta. Recortar por status não serve: o banco de trabalho já tem 69
 * clientes ativos e 49 perdidos, e a conta do teste viraria "os meus mais os
 * que já estavam lá" — que é justamente o tipo de número que não prova nada.
 */
const TAMANHOS = [
  { status: "LEAD" as const, quantidade: 1, dono: "Estresse T001" },
  { status: "PAUSED" as const, quantidade: 8, dono: "Estresse T008" },
  { status: "CHURNED" as const, quantidade: 9, dono: "Estresse T009" },
  { status: "ACTIVE" as const, quantidade: 130, dono: "Estresse T130" },
];

async function main() {
  const limpar = process.argv.includes("--limpar");
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } })
  );

  await runWithOwner(admin.id, async () => {
    // Limpeza primeiro, sempre: a semente é idempotente porque rodar duas
    // vezes e dobrar a carteira faria o verificador contar errado.
    const antigos = await prisma.client.findMany({
      where: { name: { startsWith: MARCA } },
      select: { id: true },
    });
    const ids = antigos.map((c) => c.id);
    if (ids.length) {
      await prisma.payment.deleteMany({ where: { billing: { clientId: { in: ids } } } });
      await prisma.income.deleteMany({ where: { billing: { clientId: { in: ids } } } });
      await prisma.collectionHistory.deleteMany({ where: { clientId: { in: ids } } });
      await prisma.billing.deleteMany({ where: { clientId: { in: ids } } });
      await prisma.client.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.transaction.deleteMany({ where: { description: { startsWith: MARCA } } });
    console.log(`limpeza: ${ids.length} cliente(s) de estresse removido(s)`);
    if (limpar) return;

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth() + 1;
    let criados = 0;

    for (const { status, quantidade, dono } of TAMANHOS) {
      for (let i = 1; i <= quantidade; i++) {
        // Um em cada cinco leva o nome longo com acento — o suficiente para
        // provar a quebra de linha sem transformar o relatório inteiro numa
        // parede de texto.
        const nome =
          i % 5 === 0
            ? `${MARCA} ${NOME_LONGO} ${i}`
            : `${MARCA} Açaí & Cia ${status} ${String(i).padStart(3, "0")}`;
        const cliente = await prisma.client.create({
          data: {
            name: nome,
            status,
            modality: i % 3 === 0 ? "TCV" : "MRR",
            monthlyValue: 500 + (i % 12) * 137.5,
            paymentDay: ((i % 27) + 1) as number,
            startedAt: new Date(ano - 1, i % 12, ((i % 27) + 1)),
            salesOwner: dono,
            city: "Feira de Santana",
            state: "BA",
          },
          select: { id: true },
        });
        if (status === "ACTIVE") {
          const valor = 500 + (i % 12) * 137.5;
          await prisma.billing.create({
            data: {
              clientId: cliente.id,
              description: `${MARCA} Mensalidade com descrição propositalmente longa para exercitar a quebra de linha da coluna de descrição no documento impresso — item ${i}`,
              competenceMonth: mes,
              competenceYear: ano,
              amount: valor,
              // Um terço vencido, um terço a vencer, um terço pago.
              dueDate: new Date(ano, mes - 1, ((i % 27) + 1)),
              status: i % 3 === 0 ? "OVERDUE" : i % 3 === 1 ? "PENDING" : "PAID",
              paidTotal: i % 3 === 2 ? valor : 0,
              revenueType: "MRR",
            },
          });
        }
        criados++;
      }
    }

    // Despesas: uma NEGATIVA (estorno) e uma com descrição longa. Valor
    // negativo em coluna de dinheiro é o caso que some quando a célula é
    // alinhada errado ou cortada — a auditoria pede sinal e rótulo visíveis.
    await prisma.transaction.createMany({
      data: [
        {
          date: new Date(ano, mes - 1, 12),
          dueDate: new Date(ano, mes - 1, 12),
          description: `${MARCA} Estorno de cobrança indevida do provedor de anúncios`,
          amount: -1250.75,
          type: "despesa",
          status: "pago",
        },
        {
          date: new Date(ano, mes - 1, 18),
          dueDate: new Date(ano, mes - 1, 18),
          description: `${MARCA} Assinatura anual de ferramenta de automação de marketing com rateio manual entre as agências e observação extensa para forçar a quebra`,
          amount: 8430.9,
          type: "despesa",
          status: "pendente",
        },
      ],
    });

    console.log(`✓ ${criados} clientes de estresse + 2 despesas (uma negativa)`);
    console.log(
      "  tamanhos por responsável: " +
        TAMANHOS.map((t) => `${t.dono}=${t.quantidade}`).join(", ") +
        " · caso zero: \"Estresse T000\" (ninguém)"
    );
  });
}

main().catch((e) => {
  console.error("falhou:", e);
  process.exit(1);
});
