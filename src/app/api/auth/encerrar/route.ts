import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * ENCERRA UMA SESSÃO ÓRFÃ — e existe para quebrar um laço infinito.
 *
 * O middleware roda na borda e só consegue conferir a ASSINATURA do cookie;
 * ele não tem banco para perguntar se o usuário ainda existe. Já a página
 * pergunta, e manda para /login quando não acha ninguém. Quando o usuário do
 * token some do banco — conta apagada, ou um recomeço do zero — os dois se
 * contradizem para sempre: o middleware vê sessão válida e manda para o
 * painel, o painel não acha o usuário e manda para o login, e a tela fica
 * carregando sem fim.
 *
 * Aqui o cookie é APAGADO antes de devolver para o login. Sem cookie, o
 * middleware para de insistir e a tela de entrar finalmente aparece.
 */
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const destino = req.nextUrl.clone();
  destino.pathname = "/login";
  destino.search = "";
  const de = req.nextUrl.searchParams.get("from");
  if (de && de.startsWith("/")) destino.searchParams.set("from", de);
  destino.searchParams.set("sessao", "encerrada");

  const res = NextResponse.redirect(destino);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
