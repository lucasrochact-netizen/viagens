/**
 * Respostas sintéticas da SerpApi, no formato real do engine
 * google_flights. Reproduzem dois comportamentos observados em produção:
 *
 *  - chamada com vários destinos NÃO traz price_insights;
 *  - chamada com destino único traz.
 */

const perna = (de, para, cia, preco) => ({
  departure_airport: { id: de, time: "2026-12-26 10:00" },
  arrival_airport: { id: para, time: "2026-12-26 14:00" },
  airline: cia,
  flight_number: "XX 100",
});

const itinerario = (pernas, preco, duracao = 600) => ({
  flights: pernas,
  price: preco,
  total_duration: duracao,
  type: "Round trip",
});

/** 3 destinos; o mais barato aparece duas vezes para testar o dedup. */
export const RESPOSTA_MULTI = {
  search_metadata: { status: "Success" },
  best_flights: [
    itinerario([perna("GRU", "ASU", "Gol")], 2382, 100),
    itinerario([perna("CGH", "SCL", "LATAM"), perna("SCL", "SCL", "LATAM")], 2418, 400),
  ],
  other_flights: [
    itinerario([perna("GRU", "ASU", "LATAM")], 2500, 110), // mais caro: deve ser descartado
    itinerario([perna("GRU", "GRU", "Avianca"), perna("GRU", "LIM", "Avianca")], 3134, 500),
  ],
  // sem price_insights — de propósito
};

/** Destino único: traz price_insights completo. */
export const RESPOSTA_UNICA = {
  search_metadata: { status: "Success" },
  best_flights: [itinerario([perna("GRU", "ASU", "Gol")], 2382, 100)],
  other_flights: [
    itinerario([perna("CGH", "ASU", "LATAM")], 2600, 120),
    itinerario([perna("GRU", "ASU", "Paranair")], 2900, 130),
  ],
  price_insights: {
    lowest_price: 2382,
    price_level: "typical",
    typical_price_range: [1700, 2900],
    price_history: Array.from({ length: 61 }, (_, i) => [1762210800 + i * 86400, 2300 + i]),
  },
};

/** Oportunidade real: preço abaixo do piso da faixa normal. */
export const RESPOSTA_BARATA = {
  search_metadata: { status: "Success" },
  best_flights: [itinerario([perna("GRU", "LIS", "TAP")], 4000, 700)],
  price_insights: {
    lowest_price: 4000,
    price_level: "low",
    typical_price_range: [5200, 9100],
    price_history: [],
  },
};
