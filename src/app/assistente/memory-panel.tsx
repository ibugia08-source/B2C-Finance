"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { addMemory, deleteMemory, toggleMemoryPin } from "@/lib/actions/ai";
import { Pin, PinOff, Trash2, Plus, Brain } from "lucide-react";

type Memory = {
  id: string;
  kind: string;
  content: string;
  source: string;
  pinned: boolean;
};

const KIND_LABEL: Record<string, string> = {
  fact: "Fato",
  pattern: "Padrão",
  preference: "Preferência",
  alert: "Alerta",
  note: "Nota",
};

export function MemoryPanel({ memories }: { memories: Memory[] }) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("note");
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Ex.: prefiro guardar 20% da renda…"
          className="flex-1"
        />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-32">
          <option value="note">Nota</option>
          <option value="preference">Preferência</option>
          <option value="fact">Fato</option>
          <option value="pattern">Padrão</option>
          <option value="alert">Alerta</option>
        </Select>
        <Button
          size="icon"
          disabled={pending || !content.trim()}
          onClick={() => {
            const fd = new FormData();
            fd.set("content", content);
            fd.set("kind", kind);
            start(async () => {
              await addMemory(fd);
              setContent("");
            });
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {memories.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">
          <Brain className="h-5 w-5 mx-auto mb-2 opacity-40" />
          Nada na memória ainda. A IA aprende padrões ao gerar análises, e você pode adicionar fatos manualmente.
        </div>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li key={m.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Badge variant={m.pinned ? "default" : "secondary"} className="text-[10px]">
                    {KIND_LABEL[m.kind] ?? m.kind}
                  </Badge>
                  {m.source === "auto" && (
                    <span className="text-[10px] text-muted-foreground">automática</span>
                  )}
                </div>
                <p className={m.pinned ? "font-medium" : ""}>{m.content}</p>
              </div>
              <div className="flex gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={pending}
                  title={m.pinned ? "Desafixar" : "Fixar"}
                  onClick={() => start(() => toggleMemoryPin(m.id))}
                >
                  {m.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={pending}
                  title="Excluir"
                  onClick={() => start(() => deleteMemory(m.id))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
