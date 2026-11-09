/**
 * Rotas fixas de fim de semana — lógica pura, sem efeito colateral além do Store.
 *
 * Cada viagem é ida (sexta à noite ou sábado de manhã) + volta (chegando
 * domingo à noite ou segunda antes das 10h). Buscamos cada perna só de ida:
 * na SerpApi a volta de uma ida-e-volta custa uma chamada extra por opção, e
 * em voo doméstico a soma das idas é o preço da ida-e-volta.
 *
 * Pernas iguais entre rotas (UDI→SP serve à ida de uma e à volta da outra,
 * em datas diferentes) são buscadas uma vez só por execução.
 */
import { buscarIda, itinerarios, cias, SerpApiError } from "./serpapi.js";
import { hojeSP } from "./config.js";

export const SP = "CGH,GRU,VCP";
// Uberlândia, não Uberaba: UBA não existe no Google Flights (docs/varredura.md).
export const UDI = "UDI";

export const ROTAS = [
  { id: "udi-sp", nome: "Uberlândia → São Paulo", casa: UDI, destino: SP },
  { id: "sp-udi", nome: "São Paulo → Uberlândia", casa: SP, destino: UDI },
  { id: "sp-bsb", nome: "São Paulo → Brasília", casa: SP, destino: "BSB" },
  { id: "udi-gyn", nome: "Uberlândia → Goiânia", casa: UDI, destino: "GYN" },
];

/**
 * offset = dias a partir da sexta. `horarios` vai para o Google; `aceita`
 * confere de novo do nosso lado, com data E hora — o filtro do Google olha
 * só a hora, e um voo de segunda 18:20 chegando terça 06:25 passaria como
 * "chega antes das 10h".
 */
export const JANELAS = {
  ida: [
    { id: "sex-noite", rotulo: "sex à noite", offset: 0, horarios: "18,23", aceita: (o, d) => dia(o.partida) === d && hora(o.partida) >= 18 },
    { id: "sab-manha", rotulo: "sáb de manhã", offset: 1, horarios: "0,11", aceita: (o, d) => dia(o.partida) === d && hora(o.partida) < 12 },
  ],
  volta: [
    { id: "dom-noite", rotulo: "chega dom à noite", offset: 2, horarios: "0,23,18,23", aceita: (o, d) => dia(o.chegada) === d && hora(o.chegada) >= 18 },
    { id: "seg-cedo", rotulo: "chega seg até 10h", offset: 3, horarios: "0,23,0,9", aceita: (o, d) => dia(o.chegada) === d && hora(o.chegada) < 10 },
  ],
};

const hora = (dt) => Number(String(dt).slice(11, 13));
const dia = (dt) => String(dt).slice(0, 10);

const iso = (d) => d.toISOString().slice(0, 10);

/** As próximas `n` sextas estritamente depois de `hoje` (YYYY-MM-DD). */
export function proximasSextas(hoje, n) {
  const d = new Date(`${hoje}T12:00:00Z`);
  const out = [];
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() === 5) out.push(iso(d));
  }
  return out;
}

function somaDias(dataIso, dias) {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/** Opções de uma busca só de ida, com horários. */
export function opcoesIda(json) {
  return itinerarios(json)
    .filter((it) => it?.flights?.length && typeof it.price === "number")
    .map((it) => {
      const f = it.flights;
      return {
        preco: it.price,
        de: f[0].departure_airport?.id || "",
        para: f.at(-1).arrival_airport?.id || "",
        partida: f[0].departure_airport?.time || "",
        chegada: f.at(-1).arrival_airport?.time || "",
        paradas: f.length - 1,
        cia: cias(f),
        duracao: it.total_duration || 0,
      };
    })
    .sort((a, b) => a.preco - b.preco);
}

/**
 * Preferência por Congonhas: fica com o CGH mais barato, a não ser que
 * outro aeroporto saia `tolerancia` (fração) mais barato.
 */
export function escolher(opcoes, tolerancia = 0.2) {
  if (!opcoes.length) return null;
  const barata = opcoes[0];
  const tocaSP = (o) => SP.split(",").some((a) => a === o.de || a === o.para);
  if (!tocaSP(barata)) return { ...barata, motivo: "mais barata" };
  const cgh = opcoes.find((o) => o.de === "CGH" || o.para === "CGH");
  if (!cgh) return { ...barata, motivo: "sem opção em CGH" };
  if (cgh === barata) return { ...cgh, motivo: "CGH" };
  return barata.preco <= cgh.preco * (1 - tolerancia)
    ? { ...barata, motivo: `${Math.round((1 - barata.preco / cgh.preco) * 100)}% mais barato que CGH` }
    : { ...cgh, motivo: "CGH" };
}

/** Lista de buscas únicas para as rotas × fins de semana. */
export function planejar(rotas, sextas) {
  const buscas = new Map();
  const pedir = (de, para, sexta, j) => {
    const data = somaDias(sexta, j.offset);
    const chave = `${de}>${para}@${data}#${j.id}`;
    if (!buscas.has(chave)) buscas.set(chave, { chave, de, para, data, janela: j.id, horarios: j.horarios });
    return chave;
  };
  const viagens = [];
  for (const rota of rotas) {
    for (const sexta of sextas) {
      viagens.push({
        rota: rota.id, sexta,
        ida: JANELAS.ida.map((j) => ({ janela: j.id, chave: pedir(rota.casa, rota.destino, sexta, j) })),
        volta: JANELAS.volta.map((j) => ({ janela: j.id, chave: pedir(rota.destino, rota.casa, sexta, j) })),
      });
    }
  }
  return { buscas: [...buscas.values()], viagens };
}

const SEM_RESULTADO = /hasn't returned any results/i;

/**
 * @param {object} cfg  carregarConfig()
 * @param {object} [opts] { fetchImpl, hoje, dryRun, store }
 */
export async function varrerRotas(cfg, opts = {}) {
  const data = opts.hoje || hojeSP();
  const sextas = proximasSextas(data, cfg.rotas.finsDeSemana);
  const { buscas, viagens } = planejar(ROTAS, sextas);
  const janelaPorId = Object.fromEntries([...JANELAS.ida, ...JANELAS.volta].map((j) => [j.id, j]));

  const resultados = {};
  let buscasUsadas = 0;
  for (const b of buscas) {
    buscasUsadas++;
    try {
      const json = await buscarIda(cfg, b, opts);
      const ops = opcoesIda(json).filter((o) => janelaPorId[b.janela].aceita(o, b.data));
      resultados[b.chave] = { opcoes: ops };
    } catch (e) {
      // Sem voo na janela é resposta válida, não falha.
      if (e instanceof SerpApiError && SEM_RESULTADO.test(e.message)) resultados[b.chave] = { opcoes: [] };
      else {
        resultados[b.chave] = { opcoes: [], erro: e.message };
        console.error(`[rotas] ${b.chave} falhou: ${e.message}`);
      }
    }
  }

  const perna = (p) => {
    const r = resultados[p.chave];
    return { janela: p.janela, opcoes: r.opcoes, erro: r.erro, escolha: escolher(r.opcoes, cfg.rotas.toleranciaCgh) };
  };
  const montadas = viagens.map((v) => {
    const ida = v.ida.map(perna), volta = v.volta.map(perna);
    const melhor = (ps) => ps.map((p) => p.escolha).filter(Boolean).sort((a, b) => a.preco - b.preco)[0] || null;
    const mi = melhor(ida), mv = melhor(volta);
    return { ...v, ida, volta, melhorIda: mi, melhorVolta: mv, total: mi && mv ? mi.preco + mv.preco : null };
  });

  const resultado = { data, sextas, rotas: ROTAS, viagens: montadas, buscasUsadas };
  if (!opts.dryRun && opts.store) opts.store.gravarRotas(data, resultado);
  return resultado;
}

/** Texto curto para o log do cron. */
export function relatorioRotas(r) {
  const brl = (n) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
  const L = [`ROTAS FIXAS - ${r.data}  (${r.buscasUsadas} buscas)`];
  for (const rota of r.rotas) {
    L.push(`\n[${rota.nome}]`);
    for (const v of r.viagens.filter((x) => x.rota === rota.id)) {
      const desc = (o, campo) => (o ? `${o[campo].slice(5, 16)} ${o.de}>${o.para} ${o.cia} ${brl(o.preco)}` : "sem voo na janela");
      L.push(`  fds ${v.sexta}: ${v.total ? brl(v.total) : "—"}   ida sai ${desc(v.melhorIda, "partida")}  |  volta chega ${desc(v.melhorVolta, "chegada")}`);
    }
  }
  return L.join("\n");
}
