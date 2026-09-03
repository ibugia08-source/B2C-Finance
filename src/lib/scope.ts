/**
 * RECORTE DE DADOS DO USUÁRIO (F1.10 · ref. 03 §1.1).
 *
 * A spec listava cinco escopos: workspace, EntidadeLegal, Agência, meus
 * clientes e compartilhados explícitos. Sobraram DOIS, e as ausências são
 * decisão da direção em 31/08, não simplificação:
 *
 *   · "meus clientes" (19.11) — dependia de saber quais clientes são do
 *     usuário logado, e isso exigiria ligar o USUÁRIO do sistema à PESSOA da
 *     folha. A direção decidiu que esse vínculo não existe: Raiane e Bianca
 *     estão nos dois lugares e os registros são independentes de propósito.
 *     Sem vínculo, "meus" só poderia ser adivinhado por nome — e adivinhar
 *     quem vê o quê é pior do que não recortar.
 *   · "EntidadeLegal" (19.15) — a entidade legal não é uma divisão real hoje:
 *     as agências não têm CNPJ nem razão social, existem só para organizar
 *     quais clientes são de quem. Recortar por uma divisão que não existe
 *     produziria escopo vazio.
 *   · "compartilhados explícitos" — não há caso de uso; entra quando houver.
 *
 * Fica a AGÊNCIA, que é exatamente o que a direção disse que a agência é.
 *
 * Módulo NEUTRO de propósito (sem prisma, sem next): a barra superior e o
 * painel de usuários são client components e precisam disto.
 */

export type DataScope =
  | { kind: "WORKSPACE" }
  | { kind: "AGENCY"; agencyId: string };

export type ScopedUserLike = {
  role?: string | null;
  dataScope?: string | null;
  scopeAgencyId?: string | null;
};

export const ESCOPO_PADRAO: DataScope = { kind: "WORKSPACE" };

/**
 * Lê o recorte gravado no usuário.
 *
 * ADMIN é sempre WORKSPACE, e isso é regra fixa: 03 §1.1 diz "ADMIN permite"
 * sem exceção, e um dono que se recorta sem querer some da própria carteira
 * sem entender por quê. Estreitar o que o dono vê é filtro de tela, não
 * permissão.
 */
export function parseDataScope(user: ScopedUserLike | null | undefined): DataScope {
  if (!user) return ESCOPO_PADRAO;
  if (user.role === "ADMIN") return ESCOPO_PADRAO;
  if (user.dataScope === "AGENCY" && user.scopeAgencyId) {
    return { kind: "AGENCY", agencyId: user.scopeAgencyId };
  }
  return ESCOPO_PADRAO;
}

/**
 * Pedaço estável para a chave de cache (03 §1.4 pede userScope na chave).
 *
 * Sem isto, dois usuários do MESMO dono com recortes diferentes compartilham
 * cache — que é a mesma família de falha que a F1.11 corrigiu entre Admin e
 * Gestor. O userId já entra na chave hoje, então isto é cinto e suspensório:
 * se um dia a chave for afrouxada para caber mais gente no mesmo cache, o
 * recorte continua separando.
 */
export function scopeFingerprint(scope: DataScope): string {
  return scope.kind === "WORKSPACE" ? "ws" : `ag:${scope.agencyId}`;
}

export function isScoped(scope: DataScope): scope is { kind: "AGENCY"; agencyId: string } {
  return scope.kind === "AGENCY";
}
