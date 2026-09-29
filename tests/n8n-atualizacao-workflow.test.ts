import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { mesclar, escolherBase, CHAVES_DE_NO, CHAVES_DE_SETTINGS } from "../integrations/n8n/scripts/preparar-atualizacao-workflow.mjs";

/**
 * ATUALIZAÇÃO DO WORKFLOW EXISTENTE (p7O54hZQ4aGl3AKN) SEM DUPLICAR — merge
 * em três vias (base = versão importada antes; atual = instância; novo =
 * repositório). Preserva id, nome, settings, ids de nó, webhookId, posição e
 * credenciais reais; preserva customização da instância; para em conflito.
 */
const W = join(process.cwd(), "integrations/n8n/workflows/b2c-finance-telegram-agent-readonly.json");
const novo = JSON.parse(readFileSync(W, "utf8"));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** "Instância": a base importada, com id, ids de nó, credenciais reais e settings próprios. */
function instanciaDe(base: any) {
  const a = clone(base);
  a.id = "p7O54hZQ4aGl3AKN";
  a.name = "Agente Telegram (produção)";
  a.activeVersionId = "ver-antiga-123";
  a.settings = { ...a.settings, timezone: "America/Bahia", errorWorkflow: "wfErro01", campoInterno: "x" };
  const real: Record<string, { id: string; name: string }> = {
    telegramApi: { id: "credTg01", name: "Telegram account" },
    httpHeaderAuth: { id: "credB2c01", name: "B2C API prod" },
    openAiApi: { id: "credOai01", name: "OpenAi account" },
    qdrantApi: { id: "credQd01", name: "Qdrant prod" },
  };
  a.nodes.forEach((n: any, i: number) => {
    n.id = `uuid-${i}`;
    n.position = [i * 10, 7];
    if (n.type === "n8n-nodes-base.telegramTrigger") n.webhookId = "webhook-da-instancia";
    for (const t of Object.keys(n.credentials ?? {})) n.credentials[t] = real[t];
  });
  return a;
}

// Base = o novo SEM a ferramenta de inadimplência e com as descrições antigas (simula a versão anterior).
const base = clone(novo);
base.nodes = base.nodes.filter((n: any) => n.name !== "consultar_inadimplencia");
for (const n of base.nodes) if (n.name === "consultar_recebimentos") n.parameters.toolDescription = "descrição antiga";
delete base.connections["consultar_inadimplencia"];

describe("merge da atualização", () => {
  it("preserva id, nome, settings aceitos, ids de nó, webhookId, posição e credenciais; adiciona a ferramenta nova com a credencial da instância", () => {
    const atual = instanciaDe(base);
    const r: any = mesclar({ atual, base, novo, idEsperado: "p7O54hZQ4aGl3AKN" });
    expect(r.conflitos).toEqual([]);
    expect(r.corpo.name).toBe("Agente Telegram (produção)");
    expect(Object.keys(r.corpo).sort()).toEqual(["connections", "name", "nodes", "settings"]);
    expect(r.corpo.settings).toMatchObject({ timezone: "America/Bahia", errorWorkflow: "wfErro01" });
    expect(r.corpo.settings).not.toHaveProperty("campoInterno"); // a API recusaria
    for (const k of Object.keys(r.corpo.settings)) expect(CHAVES_DE_SETTINGS).toContain(k);
    const porNome = Object.fromEntries(r.corpo.nodes.map((n: any) => [n.name, n]));
    const gatilho: any = r.corpo.nodes.find((n: any) => n.type === "n8n-nodes-base.telegramTrigger");
    expect(gatilho.webhookId).toBe("webhook-da-instancia");
    expect(gatilho.credentials.telegramApi).toEqual({ id: "credTg01", name: "Telegram account" });
    expect(porNome["consultar_recebimentos"].id).toMatch(/^uuid-/);
    expect(porNome["consultar_recebimentos"].parameters.toolDescription).not.toBe("descrição antiga"); // mudou no repositório → vai o novo
    const inad = porNome["consultar_inadimplencia"];
    expect(inad.id).toMatch(/^[0-9a-f-]{36}$/); // nó novo: id novo
    expect(inad.credentials.httpHeaderAuth).toEqual({ id: "credB2c01", name: "B2C API prod" });
    expect(JSON.stringify(r.corpo)).not.toContain("CONFIGURAR_");
    for (const n of r.corpo.nodes) for (const k of Object.keys(n)) expect(CHAVES_DE_NO).toContain(k);
    expect(r.corpo.connections["consultar_inadimplencia"]).toBeTruthy();
    expect(r.relatorio).toContain("ver-antiga-123");
    expect(r.relatorio).toContain("| consultar_inadimplencia | NOVO |");
  });

  it("customização da instância em nó que o repositório não mudou é PRESERVADA (ex.: modelo de IA)", () => {
    const atual = instanciaDe(base);
    atual.nodes.find((n: any) => n.name === "Modelo de IA").parameters.model.value = "gpt-4.1-mini";
    const r: any = mesclar({ atual, base, novo });
    expect(r.conflitos).toEqual([]);
    expect(r.corpo.nodes.find((n: any) => n.name === "Modelo de IA").parameters.model.value).toBe("gpt-4.1-mini");
    expect(r.relatorio).toContain("customização da instância preservada");
  });

  it("customização em nó que o repositório TAMBÉM mudou = conflito (nada gerado) até --resolver", () => {
    const atual = instanciaDe(base);
    atual.nodes.find((n: any) => n.name === "consultar_recebimentos").parameters.toolDescription = "texto editado na instância";
    const r: any = mesclar({ atual, base, novo });
    expect(r.conflitos.map((c: any) => c.no)).toEqual(["consultar_recebimentos"]);
    expect(r.conflitos[0].instancia).toContain("parameters.toolDescription");
    const ok: any = mesclar({ atual, base, novo, resolver: { consultar_recebimentos: "novo" } });
    expect(ok.conflitos).toEqual([]);
  });

  it("nó que só existe na instância para o merge; --resolver decide manter ou remover", () => {
    const atual = instanciaDe(base);
    atual.nodes.push({ id: "extra", name: "Nó extra da instância", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [0, 0], parameters: {} });
    expect(mesclar({ atual, base, novo }).conflitos.map((c: any) => c.no)).toEqual(["Nó extra da instância"]);
    const manter: any = mesclar({ atual, base, novo, resolver: { "Nó extra da instância": "manter" } });
    expect(manter.corpo.nodes.some((n: any) => n.name === "Nó extra da instância")).toBe(true);
  });

  it("recusa export de outro workflow; escolhe a base certa entre versões", () => {
    const atual = instanciaDe(base);
    expect(() => mesclar({ atual, base, novo, idEsperado: "OUTRO" })).toThrow(/não de OUTRO/);
    const escolhida: any = escolherBase(atual, [{ sha: "novo", wf: novo }, { sha: "base", wf: base }]);
    expect(escolhida.sha).toBe("base");
  });
});
