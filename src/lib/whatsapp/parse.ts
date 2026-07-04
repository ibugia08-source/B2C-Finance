export type IncomingMessage = {
  from?: string;
  text?: string;
  imageUrl?: string;
  fromMe: boolean;
  waType: "text" | "image" | "audio" | "other";
};

/** Parser tolerante para payloads de webhook (Z-API e Evolution API). */
export function parseIncoming(body: any): IncomingMessage {
  if (!body || typeof body !== "object") return { fromMe: false, waType: "other" };

  // ---- Z-API ----
  if (body.phone || body.text || body.image || body.audio) {
    const text =
      (typeof body.text === "string" ? body.text : body.text?.message) ??
      body.image?.caption ??
      undefined;
    const imageUrl = body.image?.imageUrl ?? body.image?.url ?? undefined;
    const audioUrl = body.audio?.audioUrl ?? body.audio?.url ?? undefined;
    return {
      from: body.phone,
      text,
      imageUrl,
      fromMe: !!body.fromMe,
      waType: imageUrl ? "image" : audioUrl ? "audio" : "text",
    };
  }

  // ---- Evolution API ----
  const data = body.data ?? body;
  const key = data?.key;
  if (key) {
    const jid: string = key.remoteJid ?? "";
    const from = jid.split("@")[0];
    const msg = data.message ?? {};
    const text =
      msg.conversation ??
      msg.extendedTextMessage?.text ??
      msg.imageMessage?.caption ??
      undefined;
    const imageUrl = msg.imageMessage?.url ?? data.mediaUrl ?? undefined;
    const audio = msg.audioMessage;
    return {
      from,
      text,
      imageUrl,
      fromMe: !!key.fromMe,
      waType: imageUrl ? "image" : audio ? "audio" : "text",
    };
  }

  return { fromMe: false, waType: "other" };
}
