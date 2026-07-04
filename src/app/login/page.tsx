import { B2CSymbol, B2CMascot } from "@/components/mascot";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Entrar — B2C Finance",
};

export default function LoginPage() {
  return (
    <div className="dark min-h-screen app-shell flex items-center justify-center p-6 text-foreground">
      <div className="w-full max-w-4xl grid lg:grid-cols-2 gap-10 items-center">
        {/* Lado esquerdo: mascote em destaque (desktop) */}
        <div className="hidden lg:flex flex-col items-center text-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 -z-10 blur-3xl bg-primary/25 rounded-full scale-90" />
            <B2CMascot pose="hero" width={300} className="relative drop-shadow-2xl" />
          </div>
          <div>
            <div className="flex items-center justify-center gap-3">
              <B2CSymbol size={36} />
              <h1 className="text-3xl font-bold tracking-tight leading-none">
                B2C <span className="text-primary">Finance</span>
              </h1>
            </div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-3">
              Inteligência financeira. Liberdade real.
            </p>
          </div>
        </div>

        {/* Lado direito: card de login */}
        <div className="w-full max-w-md mx-auto">
          <div className="rounded-2xl border bg-card shadow-xl overflow-hidden">
            <div className="px-8 pt-8 pb-4 flex items-center gap-4 border-b lg:hidden">
              <B2CSymbol size={48} />
              <div>
                <h1 className="text-xl font-bold tracking-tight leading-none">
                  B2C <span className="text-primary">Finance</span>
                </h1>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1.5">
                  Inteligência financeira.
                </p>
              </div>
            </div>

            <div className="px-8 py-8 space-y-6">
              {/* Mascote no mobile */}
              <div className="lg:hidden flex justify-center">
                <B2CMascot pose="hero" width={150} className="drop-shadow-xl" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Entrar na sua conta</h2>
                <p className="text-sm text-muted-foreground">
                  Acesse sua visão financeira com segurança.
                </p>
              </div>
              <LoginForm />
            </div>

            <div className="px-8 py-4 border-t bg-muted/30 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>v1.0 · Rebrand</span>
              <span className="text-gold">★ premium</span>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground mt-4">
            Acesso restrito · use suas credenciais cadastradas.
          </p>
        </div>
      </div>
    </div>
  );
}
