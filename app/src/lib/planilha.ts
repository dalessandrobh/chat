/**
 * Leitura de planilha de contatos.
 *
 * Fica separado da tela porque é a parte que erra: nome de coluna que ninguém
 * previu, número escrito de seis jeitos, acento que vira caractere estranho.
 * Aqui dá para conferir cada regra sem abrir o navegador.
 *
 * Só formatos de texto — CSV, TSV. `.xlsx` é um zip de XML e exigiria uma
 * biblioteca; a única publicada no npm está parada desde 2022 com falhas
 * conhecidas, e não vale carregá-la para dentro do projeto quando o Excel e o
 * Google Planilhas exportam CSV em dois cliques.
 */

export interface LinhaImportada {
  /** Número da linha no arquivo, contando o cabeçalho. Para o usuário achar. */
  linha: number;
  nome: string;
  waId: string;
  tags: string[];
  /** Preenchido quando a linha entra mesmo assim, mas com ressalva. */
  aviso?: string;
}

export interface LinhaRejeitada {
  linha: number;
  motivo: string;
  conteudo: string;
}

export interface Leitura {
  contatos: LinhaImportada[];
  rejeitadas: LinhaRejeitada[];
  /** Quantas linhas repetiam um número já visto antes no mesmo arquivo. */
  repetidas: number;
  /** Como as colunas foram entendidas, para a tela poder mostrar. */
  colunas: { nome: number; numero: number; tags: number | null };
  temCabecalho: boolean;
}

// -----------------------------------------------------------------------------
// Texto
// -----------------------------------------------------------------------------

/**
 * O Excel brasileiro salva CSV em Windows-1252, não em UTF-8. Decodificar como
 * UTF-8 transforma todo "José" em "Jos<?>" — e o nome é justamente o que vai
 * dentro da mensagem. Quando aparece o caractere de substituição, relê.
 */
export function decodificar(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1252").decode(buffer);
}

/**
 * Ponto e vírgula primeiro: é o que o Excel em português usa, e é o que salva
 * quem tem "Silva, Maria" no meio da planilha sem aspas.
 */
export function detectarDelimitador(texto: string): string {
  const amostra = texto.split(/\r?\n/).slice(0, 20).join("\n");
  const contar = (d: string) => amostra.split(d).length - 1;
  const candidatos: Array<[string, number]> = [
    [";", contar(";")],
    ["\t", contar("\t")],
    [",", contar(",")],
  ];
  const vencedor = candidatos.reduce((a, b) => (b[1] > a[1] ? b : a));
  return vencedor[1] > 0 ? vencedor[0] : ";";
}

/** CSV com aspas, incluindo `""` escapado e quebra de linha dentro do campo. */
export function parseDelimitado(texto: string, delim: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let emAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          emAspas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') emAspas = true;
    else if (c === delim) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }

  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

// -----------------------------------------------------------------------------
// Número
// -----------------------------------------------------------------------------

export type Numero =
  | { ok: true; waId: string; aviso?: string }
  | { ok: false; motivo: string };

/**
 * Decide pelo TAMANHO, não pelo prefixo.
 *
 * O atalho óbvio — "começa com 55, então já tem o país" — quebra em Santa
 * Maria: o DDD 55 existe. `55999998888` tem onze dígitos e é um celular do
 * DDD 55, não um número já internacionalizado. Contar dígitos resolve os dois
 * casos sem ambiguidade.
 */
export function normalizarNumero(bruto: string): Numero {
  const digitos = (bruto ?? "").replace(/\D/g, "").replace(/^0+/, "");

  if (!digitos) return { ok: false, motivo: "sem número" };

  // DDD + celular de 9, ou DDD + fixo de 8. Falta o país.
  if (digitos.length === 11) return { ok: true, waId: `55${digitos}` };
  if (digitos.length === 10) {
    return { ok: true, waId: `55${digitos}`, aviso: "sem o 9º dígito — confira se é celular" };
  }

  if (digitos.length === 13 && digitos.startsWith("55")) return { ok: true, waId: digitos };
  if (digitos.length === 12 && digitos.startsWith("55")) {
    return { ok: true, waId: digitos, aviso: "sem o 9º dígito — confira se é celular" };
  }

  // Fora do Brasil. O banco aceita de 8 a 15 dígitos; não há o que conferir.
  if (digitos.length >= 12 && digitos.length <= 15) {
    return { ok: true, waId: digitos, aviso: "número de outro país" };
  }

  if (digitos.length <= 9) return { ok: false, motivo: "falta o DDD" };
  return { ok: false, motivo: `${digitos.length} dígitos — não parece um telefone` };
}

// -----------------------------------------------------------------------------
// Colunas
// -----------------------------------------------------------------------------

const SINONIMOS = {
  nome: ["nome", "name", "cliente", "contato", "razao social", "razão social", "nome completo"],
  numero: [
    "numero", "número", "telefone", "celular", "whatsapp", "whats", "fone",
    "tel", "phone", "mobile", "num", "telefone 1", "celular 1",
  ],
  tags: ["tags", "tag", "etiqueta", "etiquetas", "grupo", "categoria", "segmento", "lista"],
};

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function acharColuna(cabecalho: string[], chave: keyof typeof SINONIMOS): number {
  const alvos = SINONIMOS[chave].map(semAcento);
  return cabecalho.findIndex((c) => alvos.includes(semAcento(c)));
}

/**
 * É cabeçalho se nenhuma célula da primeira linha vira um número válido. Uma
 * planilha que começa direto nos dados não tem como ter um telefone no título
 * da coluna, e uma que tem cabeçalho não tem como ter um telefone ali.
 */
function pareceCabecalho(primeira: string[]): boolean {
  return !primeira.some((c) => normalizarNumero(c).ok);
}

// -----------------------------------------------------------------------------

export function lerPlanilha(texto: string, tagsExtras: string[] = []): Leitura {
  const grade = parseDelimitado(texto, detectarDelimitador(texto)).filter(
    (l) => l.some((c) => c.trim() !== "")
  );

  const vazio: Leitura = {
    contatos: [],
    rejeitadas: [],
    repetidas: 0,
    colunas: { nome: 0, numero: 1, tags: null },
    temCabecalho: false,
  };
  if (grade.length === 0) return vazio;

  const temCabecalho = pareceCabecalho(grade[0]);
  const cabecalho = temCabecalho ? grade[0] : [];

  // Sem cabeçalho, a convenção é a do modelo: nome, número, etiquetas.
  const colunas = temCabecalho
    ? {
        nome: acharColuna(cabecalho, "nome"),
        numero: acharColuna(cabecalho, "numero"),
        tags: acharColuna(cabecalho, "tags"),
      }
    : { nome: 0, numero: 1, tags: 2 };

  // Cabeçalho que não bate com nada conhecido: cai na ordem do modelo, que é
  // melhor do que recusar a planilha inteira por causa do nome de uma coluna.
  if (colunas.nome < 0) colunas.nome = 0;
  if (colunas.numero < 0) colunas.numero = colunas.nome === 1 ? 0 : 1;

  const corpo = temCabecalho ? grade.slice(1) : grade;
  const offset = temCabecalho ? 2 : 1;

  const contatos: LinhaImportada[] = [];
  const rejeitadas: LinhaRejeitada[] = [];
  const vistos = new Set<string>();
  let repetidas = 0;

  corpo.forEach((celulas, i) => {
    const linha = i + offset;
    const nome = (celulas[colunas.nome] ?? "").trim();
    const numeroBruto = (celulas[colunas.numero] ?? "").trim();
    const conteudo = celulas.join(" | ").slice(0, 80);

    if (!nome) {
      rejeitadas.push({ linha, motivo: "sem nome", conteudo });
      return;
    }

    const numero = normalizarNumero(numeroBruto);
    if (!numero.ok) {
      rejeitadas.push({ linha, motivo: numero.motivo, conteudo });
      return;
    }

    // Primeira ocorrência vence. Planilha exportada de CRM repete cliente que
    // tem dois cadastros, e a primeira linha costuma ser a mais recente.
    if (vistos.has(numero.waId)) {
      repetidas++;
      return;
    }
    vistos.add(numero.waId);

    const daLinha =
      colunas.tags !== null && colunas.tags >= 0
        ? (celulas[colunas.tags] ?? "")
            .split(/[,;|/]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    contatos.push({
      linha,
      nome: nome.slice(0, 200),
      waId: numero.waId,
      tags: [...new Set([...daLinha, ...tagsExtras])].slice(0, 20).map((t) => t.slice(0, 40)),
      aviso: numero.aviso,
    });
  });

  return { contatos, rejeitadas, repetidas, colunas, temCabecalho };
}

/** O modelo que o botão "Baixar modelo" entrega. */
export const MODELO_CSV = [
  "nome;telefone;etiquetas",
  "Maria Silva;(31) 99999-8888;clientes-2025",
  "João Souza;31 98888-7777;clientes-2025,bh",
  "Ana Ferreira;5531977776666;orcamento",
].join("\n");
