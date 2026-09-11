import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, createOwner, destroyOwner, prisma, type TestOwner } from "./support/db";
import {
  JANELA_COMPROMISSO_PADRAO, definirJanelaDeCompromisso, getLiquidez,
} from "@/lib/services/liquidity";

/**
 * LIQUIDEZ DISPONÍVEL v2 — o card que responde "posso gastar?".
 *
 * A v1 descontava as reservas restritas (CashBox). Com as reservas removidas
 * (10/09/2026), o desconto passou a ser o COMPROMISSO IMEDIATO: conta a pagar
 * já vencida ou vencendo dentro da janela configurada.
 *
 * O que estes testes guardam é a mesma regra de antes, com outra fonte:
 * dinheiro que já tem dono e data NÃO aparece como disponível. Mostrar o
 * saldo bruto é o que faz alguém aprovar uma despesa contra o aluguel que
 * vence na sexta.
 */
describe("liquidez disponível — contas ativas menos compromissos imediatos", () => {
  let dono: TestOwner;
  const hoje = new Date();
  const dias = (d: number) => new Date(hoje.getTime() + d * 86_400_000);

  beforeAll(async () => {
    dono = await createOwner();
    await asOwner(dono, async () => {
      await prisma.account.create({
        data: { name: "Conta ativa", type: "corrente", balance: 10_000, active: true },
      });
      // Conta INATIVA não entra: saldo de conta encerrada não é dinheiro.
      await prisma.account.create({
        data: { name: "Conta encerrada", type: "corrente", balance: 4_000, active: false },
      });
      await prisma.transaction.createMany({
        data: [
          { description: "Aluguel vencido", amount: 1_500, type: "despesa",
            status: "pendente", date: dias(-10), dueDate: dias(-10) },
          { description: "Energia da semana", amount: 500, type: "despesa",
            status: "pendente", date: dias(-1), dueDate: dias(3) },
          { description: "Ferramenta do fim do mês", amount: 900, type: "despesa",
            status: "pendente", date: dias(-1), dueDate: dias(20) },
          { description: "Já paga", amount: 700, type: "despesa",
            status: "pago", date: dias(-2), dueDate: dias(2) },
        ],
      });
    });
  });
  afterAll(async () => {
    // O workspace do banco de teste é singleton: quem mexe na configuração
    // devolve o padrão, senão o arquivo seguinte herda a janela de outro.
    await asOwner(dono, async () => definirJanelaDeCompromisso(JANELA_COMPROMISSO_PADRAO));
    await destroyOwner(dono);
  });

  it("o disponível é o saldo das contas ATIVAS menos o que vence na janela", async () => {
    const l = await asOwner(dono, async () => getLiquidez(hoje.toISOString()));
    expect(l.janelaDias).toBe(JANELA_COMPROMISSO_PADRAO);
    expect(l.contas).toBe(10_000); // a conta encerrada ficou de fora
    // Vencida (1.500) + dentro de 7 dias (500). A de 20 dias não é imediata,
    // e a já paga não é compromisso nenhum.
    expect(l.compromissos).toBe(2_000);
    expect(l.disponivel).toBe(8_000);
  });

  it("a composição abre a conta: as contas e o compromisso, com sinal", async () => {
    const l = await asOwner(dono, async () => getLiquidez(hoje.toISOString()));
    expect(l.itens.some((i) => i.label === "Conta ativa" && i.value === 10_000)).toBe(true);
    expect(l.itens.some((i) => i.label === "Conta encerrada")).toBe(false);
    const compromisso = l.itens.find((i) => i.tipo === "compromisso");
    expect(compromisso?.value).toBe(-2_000);
  });

  it("a projeção de 30 dias sai do saldo BRUTO e desconta tudo uma vez só", async () => {
    const l = await asOwner(dono, async () => getLiquidez(hoje.toISOString()));
    // `saidas30d` segue sendo o que vence de hoje até 30 dias: 500 + 900.
    expect(l.saidas30d).toBe(1_400);

    // A projeção, porém, NÃO se monta a partir do `disponivel`.
    //
    // A fórmula antiga era `disponivel + entradas30d − saidas30d` e dava
    // 6.600 — quinhentos reais a menos do que a aritmética do cenário. A
    // energia de 500 vence em 3 dias, então cabia ao mesmo tempo na janela
    // de compromisso imediato (7 dias) e na janela de 30 dias: saía do
    // `disponivel` E do `saidas30d`, descontada DUAS VEZES. O comentário
    // antigo aqui já desconfiava do problema, mas só olhou a parcela
    // vencida; a que vence dentro da janela tinha o mesmo defeito.
    //
    // A conta certa é direta: 10.000 de saldo, 2.900 a pagar em 30 dias,
    // nada a receber. Sobram 7.100.
    expect(l.projecao30d).toBe(7_100);
    expect(l.projecao.partida).toBe(10_000);
    expect(l.projecao.aPagar).toBe(2_900);
    expect(l.projecao.aReceber).toBe(0);
    expect(l.projecao30d).toBe(
      l.projecao.partida + l.projecao.aReceber - l.projecao.aPagar - l.projecao.passivoFinanciado
    );
  });

  it("o vencido não é contado duas vezes nem somado como entrada", async () => {
    const l = await asOwner(dono, async () => getLiquidez(hoje.toISOString()));
    // O aluguel vencido aparece UMA vez, dentro de aPagar do horizonte.
    expect(l.projecao.aPagar).toBe(2_900);
    // E nenhuma cobrança vencida foi inventada como entrada garantida — era
    // isso que fazia o alerta "Atenção hoje" divergir do card ao lado (DA-01).
    expect(l.projecao.aReceberVencido).toBe(0);
  });

  it("a janela é configurável: com 30 dias, a conta do fim do mês já compromete", async () => {
    await asOwner(dono, async () => definirJanelaDeCompromisso(30));
    const l = await asOwner(dono, async () => getLiquidez(hoje.toISOString()));
    expect(l.janelaDias).toBe(30);
    expect(l.compromissos).toBe(2_900);
    expect(l.disponivel).toBe(7_100);
    await asOwner(dono, async () => definirJanelaDeCompromisso(JANELA_COMPROMISSO_PADRAO));
  });

  it("janela fora de 0-90 é recusada — configuração não vira número inventado", async () => {
    const r = await asOwner(dono, async () => definirJanelaDeCompromisso(400));
    expect(r.ok).toBe(false);
  });
});
