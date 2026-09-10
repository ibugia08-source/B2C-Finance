"use client";
import { useId, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "@/lib/actions/auth";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

/**
 * Formulário de acesso. A autenticação inteira continua na Server Action
 * `loginAction` — bloqueio por tentativas, tempo constante contra
 * enumeração de e-mail, cookie de sessão e redirecionamento. Aqui só
 * mora a apresentação: nada de senha em log, nada de validação paralela
 * que possa divergir da regra do servidor.
 */

function SubmitButton() {
  // useFormStatus só enxerga o <form> ancestral — por isso o botão é um
  // componente à parte. É ele que impede o envio duplicado enquanto a
  // Server Action está em voo.
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="mt-2 h-12 w-full text-base"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? "Entrando…" : "Entrar"}
    </Button>
  );
}

export function LoginForm() {
  const [state, action] = useFormState<LoginState, FormData>(loginAction, null);
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const erroId = useId();

  return (
    <form action={action} className="space-y-5" noValidate={false}>
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="voce@empresa.com.br"
            className="h-12 pl-11 text-base"
            aria-invalid={state?.error ? true : undefined}
            aria-describedby={state?.error ? erroId : undefined}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Senha</Label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="password"
            name="password"
            type={senhaVisivel ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Sua senha"
            className="h-12 pl-11 pr-12 text-base"
            aria-invalid={state?.error ? true : undefined}
            aria-describedby={state?.error ? erroId : undefined}
            required
          />
          {/* type="button": dentro de um <form>, o padrão seria submit e o
              olho enviaria o login. aria-pressed é o que faz o leitor de
              tela anunciar a troca de estado, não só o rótulo. */}
          <button
            type="button"
            onClick={() => setSenhaVisivel((v) => !v)}
            aria-pressed={senhaVisivel}
            aria-controls="password"
            aria-label={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
            title={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {senhaVisivel ? (
              <EyeOff className="h-[18px] w-[18px]" aria-hidden />
            ) : (
              <Eye className="h-[18px] w-[18px]" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {state?.error && (
        <p
          id={erroId}
          role="alert"
          className="rounded-input border border-destructive/40 bg-danger-soft px-3.5 py-2.5 text-dense text-destructive"
        >
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
