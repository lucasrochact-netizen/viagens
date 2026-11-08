/**
 * Configuração da varredura de passagens.
 *
 * Tudo vem de variável de ambiente, com padrões sensatos. Nada de chave
 * no código — ver .env.example.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Máximo de 8 aeroportos por região.
 *
 * Não é estética: a API aceita até 10-11 no `arrival_id` e falha acima
 * disso. E o orçamento de ~40 itinerários é POR CHAMADA, não por
 * aeroporto — acima de 8 os destinos só brigam pelos mesmos slots.
 * Ver docs/varredura.md.
 */
export const MAX_AEROPORTOS_POR_REGIAO = 8;

export const REGIOES = {
  "America do Sul": ["EZE", "SCL", "MVD", "ASU", "LIM", "BOG", "UIO", "CCS"],
  "America do N/Central": ["JFK", "MIA", "LAX", "ORD", "YYZ", "MEX", "CUN", "PTY"],
  "Europa Iberia/Medit": ["LIS", "OPO", "MAD", "BCN", "FCO", "MXP", "ATH", "VCE"],
  "Europa Centro/Norte": ["LHR", "CDG", "FRA", "AMS", "ZRH", "MUC", "CPH", "DUB"],
  "Oriente Medio": ["IST", "DXB", "DOH", "AUH", "TLV", "RUH", "CAI", "AMM"],
  Asia: ["NRT", "HND", "ICN", "BKK", "SIN", "HKG", "DEL", "KUL"],
  Pacifico: ["HNL", "SYD", "MEL", "AKL", "PPT", "NAN"],
};

export const CIDADES = {
  GRU: "São Paulo/Guarulhos", CGH: "São Paulo/Congonhas", VCP: "Campinas",
  EZE: "Buenos Aires", SCL: "Santiago", MVD: "Montevidéu", ASU: "Assunção",
  LIM: "Lima", BOG: "Bogotá", UIO: "Quito", CCS: "Caracas", LPB: "La Paz",
  VVI: "Santa Cruz", GYE: "Guayaquil", PBM: "Paramaribo",
  JFK: "Nova York", MIA: "Miami", LAX: "Los Angeles", ORD: "Chicago",
  YYZ: "Toronto", MEX: "Cidade do México", CUN: "Cancún", PTY: "Cidade do Panamá",
  LIS: "Lisboa", OPO: "Porto", MAD: "Madri", BCN: "Barcelona", CDG: "Paris",
  FCO: "Roma", MXP: "Milão", ATH: "Atenas", VCE: "Veneza",
  LHR: "Londres", FRA: "Frankfurt", AMS: "Amsterdã", ZRH: "Zurique",
  MUC: "Munique", CPH: "Copenhague", DUB: "Dublin",
  IST: "Istambul", DXB: "Dubai", DOH: "Doha", AUH: "Abu Dhabi",
  TLV: "Tel Aviv", RUH: "Riade", CAI: "Cairo", AMM: "Amã",
  NRT: "Tóquio/Narita", HND: "Tóquio/Haneda", ICN: "Seul", BKK: "Bangcoc",
  SIN: "Singapura", HKG: "Hong Kong", DEL: "Nova Delhi", KUL: "Kuala Lumpur",
  HNL: "Honolulu/Havaí", SYD: "Sydney", MEL: "Melbourne", AKL: "Auckland",
  PPT: "Papeete/Taiti", NAN: "Nadi/Fiji",
  JNB: "Joanesburgo", CPT: "Cidade do Cabo", CMN: "Casablanca",
};

/** "Assunção (ASU)" — código desconhecido cai de volta pra sigla. */
export function cidade(cod) {
  return CIDADES[cod] ? `${CIDADES[cod]} (${cod})` : cod;
}

export function carregarConfig(env = process.env) {
  const regioes = {};
  for (const [nome, aeroportos] of Object.entries(REGIOES)) {
    if (aeroportos.length > MAX_AEROPORTOS_POR_REGIAO) {
      throw new Error(
        `Região "${nome}" tem ${aeroportos.length} aeroportos; o máximo é ${MAX_AEROPORTOS_POR_REGIAO}.`,
      );
    }
    regioes[nome] = aeroportos;
  }

  return {
    apiKey: env.SERPAPI_KEY || "",
    origem: env.VARREDURA_ORIGEM || "GRU,CGH,VCP",
    ida: env.VARREDURA_IDA || "",
    volta: env.VARREDURA_VOLTA || "",
    moeda: env.VARREDURA_MOEDA || "BRL",
    // true = price_insights de todas as regiões (2x o custo em buscas).
    gatilhoTodas: (env.VARREDURA_GATILHO_TODAS ?? "true") !== "false",
    nGatilhos: Number(env.VARREDURA_N_GATILHOS || 1),
    dataDir: env.VARREDURA_DATA_DIR || path.join(ROOT, "data", "varredura"),
    regioes,
  };
}
