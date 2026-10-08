/**
 * Edição que o cliente faz no WhatsApp, quando chega cifrada.
 *
 * O texto novo vem cifrado com o segredo da mensagem original (AES-GCM, chave
 * derivada por HMAC como no voto de enquete do Baileys, com o caso de uso
 * "Message Edit"). Quem edita e quem escreveu a original são o mesmo contato,
 * então o mesmo identificador entra duas vezes na derivação — e só o
 * identificador certo (telefone ou LID) decifra: errar não produz texto
 * trocado, produz falha na autenticação.
 */

import { createDecipheriv, createHmac } from "node:crypto";

/**
 * Bytes como a Evolution os serializa no webhook: objeto indexado
 * ({"0": 94, ...}), Buffer JSON ({type, data}), lista ou base64.
 */
export function bytesDe(valor: unknown): Buffer | null {
  if (typeof valor === "string") return Buffer.from(valor, "base64");
  if (Array.isArray(valor)) return Buffer.from(valor);
  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    if (Array.isArray(objeto.data)) return Buffer.from(objeto.data as number[]);
    const numeros = Object.values(objeto);
    if (numeros.length && numeros.every((n) => typeof n === "number")) {
      return Buffer.from(numeros as number[]);
    }
  }
  return null;
}

export interface EdicaoCifrada {
  encPayload: Buffer;
  encIv: Buffer;
}

export function decifrarEdicao(
  edicao: EdicaoCifrada,
  segredo: Buffer,
  idDaMensagem: string,
  jidDoContato: string
): string | null {
  const hmac = (dados: Buffer, chave: Buffer) =>
    createHmac("sha256", chave).update(dados).digest();

  const assinatura = Buffer.concat([
    Buffer.from(idDaMensagem),
    Buffer.from(jidDoContato),
    Buffer.from(jidDoContato),
    Buffer.from("Message Edit"),
    Buffer.from([1]),
  ]);
  const chave = hmac(assinatura, hmac(segredo, Buffer.alloc(32)));

  const { encPayload, encIv } = edicao;
  if (encPayload.length <= 16) return null;

  try {
    const decifrador = createDecipheriv("aes-256-gcm", chave, encIv);
    decifrador.setAuthTag(encPayload.subarray(encPayload.length - 16));
    const aberto = Buffer.concat([
      decifrador.update(encPayload.subarray(0, encPayload.length - 16)),
      decifrador.final(),
    ]);
    return textoDaEdicao(aberto);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Protobuf mínimo: Message.protocolMessage(12).editedMessage(14) → texto
// -----------------------------------------------------------------------------

function campos(buf: Buffer): Map<number, Buffer> {
  const achados = new Map<number, Buffer>();
  let pos = 0;

  const varint = (): number => {
    let valor = 0;
    let deslocamento = 0;
    while (pos < buf.length) {
      const byte = buf[pos++];
      valor += (byte & 0x7f) * 2 ** deslocamento;
      if (!(byte & 0x80)) return valor;
      deslocamento += 7;
    }
    throw new Error("varint truncado");
  };

  while (pos < buf.length) {
    const cabecalho = varint();
    const numero = Math.floor(cabecalho / 8);
    const tipo = cabecalho % 8;
    if (tipo === 0) varint();
    else if (tipo === 1) pos += 8;
    else if (tipo === 5) pos += 4;
    else if (tipo === 2) {
      const tamanho = varint();
      if (pos + tamanho > buf.length) throw new Error("campo truncado");
      if (!achados.has(numero)) achados.set(numero, buf.subarray(pos, pos + tamanho));
      pos += tamanho;
    } else throw new Error("tipo de campo desconhecido");
  }
  return achados;
}

/** Só texto: edição de legenda de mídia fica sem o texto novo. */
export function textoDaEdicao(mensagem: Buffer): string | null {
  const editada = campos(campos(mensagem).get(12) ?? Buffer.alloc(0)).get(14);
  if (!editada) return null;

  const nova = campos(editada);
  const simples = nova.get(1);
  const estendida = nova.get(6);
  const texto = simples ?? (estendida ? campos(estendida).get(1) : undefined);
  const resultado = texto?.toString("utf8").trim();
  return resultado || null;
}
