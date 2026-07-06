import { promises as fs } from "fs";
import path from "path";

/**
 * Camada de storage de arquivos (modelos DOCX, contratos gerados e
 * documentos de clientes). O banco guarda apenas caminho + metadados.
 *
 * Driver escolhido em runtime:
 * - Supabase Storage quando SUPABASE_SERVICE_ROLE_KEY estiver configurada
 *   (produção/Vercel — bucket privado B2C_STORAGE_BUCKET).
 * - Disco local (.uploads/ na raiz do projeto) como fallback de
 *   desenvolvimento. Em Vercel o disco é efêmero: configure o Supabase.
 */
interface StorageDriver {
  name: string;
  put(filePath: string, data: Buffer, contentType: string): Promise<void>;
  get(filePath: string): Promise<Buffer>;
  remove(filePath: string): Promise<void>;
}

const BUCKET = process.env.B2C_STORAGE_BUCKET ?? "b2c-finance-files";

function supabaseDriver(baseUrl: string, serviceKey: string): StorageDriver {
  const objectUrl = (p: string) =>
    `${baseUrl.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${p
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  const headers = { Authorization: `Bearer ${serviceKey}` };

  return {
    name: "supabase",
    async put(filePath, data, contentType) {
      const res = await fetch(objectUrl(filePath), {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
        body: new Uint8Array(data),
      });
      if (!res.ok) {
        throw new Error(`Supabase Storage: falha ao salvar (${res.status} ${await res.text()})`);
      }
    },
    async get(filePath) {
      const res = await fetch(objectUrl(filePath), { headers });
      if (!res.ok) throw new Error(`Supabase Storage: arquivo não encontrado (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(filePath) {
      await fetch(objectUrl(filePath), { method: "DELETE", headers });
    },
  };
}

function localDriver(): StorageDriver {
  const root = path.join(process.cwd(), ".uploads");
  const resolve = (p: string) => {
    const full = path.resolve(root, p);
    if (!full.startsWith(root + path.sep)) throw new Error("Caminho de arquivo inválido.");
    return full;
  };
  return {
    name: "local",
    async put(filePath, data) {
      const full = resolve(filePath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
    },
    async get(filePath) {
      return fs.readFile(resolve(filePath));
    },
    async remove(filePath) {
      await fs.unlink(resolve(filePath)).catch(() => {});
    },
  };
}

function pickDriver(): StorageDriver {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return supabaseDriver(url, key);
  return localDriver();
}

let driver: StorageDriver | null = null;
function getDriver(): StorageDriver {
  if (!driver) driver = pickDriver();
  return driver;
}

/** Nome seguro para compor caminhos (sem acentos/traversal). */
export function safeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

export async function putFile(filePath: string, data: Buffer, contentType: string): Promise<void> {
  await getDriver().put(filePath, data, contentType);
}

export async function getFile(filePath: string): Promise<Buffer> {
  return getDriver().get(filePath);
}

export async function removeFile(filePath: string): Promise<void> {
  await getDriver().remove(filePath);
}

export function storageDriverName(): string {
  return getDriver().name;
}
