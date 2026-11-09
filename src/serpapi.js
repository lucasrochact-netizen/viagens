/**
 * Cliente do engine `google_flights` da SerpApi.
 *
 * Duas descobertas que moldam o uso (ver docs/varredura.md):
 *  - Vários destinos numa chamada ANULAM o price_insights.
 *  - Várias origens NÃO anulam — dá pra cobrir GRU,CGH,VCP de uma vez.
 */
const BASE = "https://serpapi.com/search.json";

export class SerpApiError extends Error {
  constructor(mensagem, { status = 0 } = {}) {
    super(mensagem);
    this.name = "SerpApiError";
    this.status = status;
  }
}

/**
 * @param {object} cfg       config de carregarConfig()
 * @param {string} arrivalId um código IATA ou vários separados por vírgula
 * @param {object} [opts]    { fetchImpl } para teste
 */
export async function buscar(cfg, arrivalId, opts = {}) {
  return requisitar(cfg, {
    departure_id: cfg.origem,
    arrival_id: arrivalId,
    outbound_date: cfg.ida,
    return_date: cfg.volta,
    type: "1", // ida e volta
  }, opts);
}

/**
 * Só ida, com filtro de horário do lado do Google.
 * `horarios` segue o outbound_times da SerpApi: "18,23" filtra a partida
 * (18:00–24:00); "0,23,18,23" filtra a chegada.
 */
export async function buscarIda(cfg, { de, para, data, horarios }, opts = {}) {
  return requisitar(cfg, {
    departure_id: de,
    arrival_id: para,
    outbound_date: data,
    type: "2",
    ...(horarios ? { outbound_times: horarios } : {}),
  }, opts);
}

/**
 * Saldo da conta. A Account API da SerpApi não conta como busca.
 * @returns {{ restantes: number, porMes: number, plano: string }}
 */
export async function saldo(cfg, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const url = new URL("https://serpapi.com/account.json");
  url.searchParams.set("api_key", cfg.apiKey);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  const j = await res.json();
  if (!res.ok || j.error) throw new SerpApiError(j.error || `HTTP ${res.status}`, { status: res.status });
  return {
    restantes: Number(j.total_searches_left ?? j.plan_searches_left ?? 0),
    porMes: Number(j.searches_per_month ?? 0),
    plano: j.plan_name || "",
  };
}

async function requisitar(cfg, especificos, opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!cfg.apiKey) throw new SerpApiError("SERPAPI_KEY não definida");

  const url = new URL(BASE);
  const params = {
    engine: "google_flights",
    currency: cfg.moeda,
    hl: "pt-br",
    gl: "br",
    ...especificos,
    api_key: cfg.apiKey,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  let json = null;
  try {
    json = await res.json();
  } catch {
    throw new SerpApiError(`resposta ilegível (HTTP ${res.status})`, { status: res.status });
  }
  if (!res.ok) throw new SerpApiError(json?.error || `HTTP ${res.status}`, { status: res.status });
  if (json?.error) throw new SerpApiError(json.error, { status: res.status });
  return json;
}

export function itinerarios(json) {
  return [...(json?.best_flights || []), ...(json?.other_flights || [])];
}

/** Companhias distintas do itinerário, na ordem dos trechos. */
export function cias(pernas) {
  const vistas = [];
  for (const p of pernas) {
    const c = p?.airline;
    if (c && !vistas.includes(c)) vistas.push(c);
  }
  return vistas.join("/");
}

/**
 * Menor preço por destino final. O destino é o aeroporto de chegada do
 * ÚLTIMO trecho — não o do primeiro, que seria a conexão.
 */
export function precoPorDestino(json) {
  const mapa = new Map();
  for (const it of itinerarios(json)) {
    const pernas = it?.flights || [];
    if (!pernas.length || typeof it.price !== "number") continue;

    const destino = pernas.at(-1)?.arrival_airport?.id;
    if (!destino) continue;

    const atual = mapa.get(destino);
    if (!atual || it.price < atual.preco) {
      mapa.set(destino, {
        destino,
        origem: pernas[0]?.departure_airport?.id || "",
        preco: it.price,
        paradas: pernas.length - 1,
        cia: cias(pernas),
        duracao: it.total_duration || 0,
      });
    }
  }
  return mapa;
}

/**
 * Todas as opções de cada destino final, da mais barata para a mais cara.
 * O mais barato muitas vezes é o de 25h; o painel filtra por duração.
 */
export function opcoesPorDestino(json) {
  const mapa = {};
  for (const it of itinerarios(json)) {
    const pernas = it?.flights || [];
    const destino = pernas.at(-1)?.arrival_airport?.id;
    if (!destino || typeof it.price !== "number") continue;
    (mapa[destino] ||= []).push({
      preco: it.price,
      paradas: pernas.length - 1,
      cia: cias(pernas),
      duracao: it.total_duration || 0,
    });
  }
  for (const lista of Object.values(mapa)) lista.sort((a, b) => a.preco - b.preco);
  return mapa;
}

/** As N opções mais baratas, para comparar companhias numa mesma rota. */
export function topOpcoes(json, n = 3) {
  return itinerarios(json)
    .filter((it) => it?.flights?.length && typeof it.price === "number")
    .map((it) => ({
      preco: it.price,
      paradas: it.flights.length - 1,
      cia: cias(it.flights),
      duracao: it.total_duration || 0,
    }))
    .sort((a, b) => a.preco - b.preco)
    .slice(0, n);
}

/**
 * price_insights, quando existe. Vem ausente em dois casos: chamada com
 * vários destinos, e rotas que o Google não tem histórico (ex.: GRU-MEX).
 */
export function insights(json) {
  const p = json?.price_insights;
  if (!p) return null;
  const faixa = Array.isArray(p.typical_price_range) ? p.typical_price_range : [];
  const historico = Array.isArray(p.price_history)
    ? p.price_history
        .filter((pt) => Array.isArray(pt) && typeof pt[1] === "number")
        .map(([ts, preco]) => ({ data: new Date(ts * 1000).toISOString().slice(0, 10), preco }))
    : [];
  return {
    preco: p.lowest_price ?? null,
    nivel: p.price_level ?? null,
    faixaMin: faixa.length === 2 ? faixa[0] : null,
    faixaMax: faixa.length === 2 ? faixa[1] : null,
    pontosHistorico: historico.length,
    historico,
  };
}

/** Veredito legível: abaixo / dentro / acima da faixa normal. */
export function avaliar(ins) {
  if (!ins || ins.faixaMin == null || ins.preco == null) return null;
  if (ins.preco < ins.faixaMin) {
    return { estado: "abaixo", pct: Math.round(((ins.faixaMin - ins.preco) / ins.faixaMin) * 100) };
  }
  if (ins.preco > ins.faixaMax) {
    return { estado: "acima", pct: Math.round(((ins.preco - ins.faixaMax) / ins.faixaMax) * 100) };
  }
  return { estado: "normal", pct: 0 };
}
