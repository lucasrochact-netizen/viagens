# Passagem de contexto — viagens

Varredura de passagens internacionais saindo de São Paulo, com série
histórica e painel web. Nasceu dentro do `fachada-bot-wa` (branch
`claude/elegant-galileo-ikyh0m`) e foi extraída para cá em 08/11/2026,
sem a entrega por WhatsApp. Decisões técnicas em [varredura.md](varredura.md).

## Estado

```
src/config.js       regiões, cidades, config por env
src/serpapi.js      cliente do engine google_flights
src/store.js        série histórica (CSV + JSON)
src/relatorio.js    saída de terminal
src/index.js        orquestração (módulo puro)
src/cli.js          entrada do cron (--check, --dry-run)
src/painel.js       rotas do painel (só leitura do data dir)
src/painel.html     a página
src/servidor.js     servidor do painel (npm run painel)
deploy/viagens-painel.service   unit do systemd
test/               16 testes, sem rede
```

Primeira execução real em 08/11/2026: 42 destinos, 7 gatilhos com
`price_insights`, 14 buscas. A série está em
`/home/claude-agent/.local/share/viagens/varredura`.

## O que falta

1. **Instalar o painel no systemd** (precisa de sudo):
   ```sh
   sudo cp deploy/viagens-painel.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now viagens-painel
   ```
2. **Rotas fixas** — ainda não especificadas. O usuário monitora rotas
   recorrentes em janelas de horário (ex.: sair sexta à noite, voltar
   segunda à noite). Falta ele informar origem, destino, janelas e dias.
   Reaproveita `serpapi.js` e `store.js`; os parâmetros `outbound_times`,
   `return_times` e `include_airlines` da SerpApi filtram do lado do servidor.
3. **Histórico do Windows** (abaixo).

## `.env`

Ver `.env.example`. Obrigatórios: `SERPAPI_KEY`, `VARREDURA_IDA`,
`VARREDURA_VOLTA`. `VARREDURA_DATA_DIR` com caminho absoluto, fora da
árvore do código, para não depender do `~` de quem roda.

## Ordem de execução

```sh
npm ci
npm test                  # 16 testes, sem rede
npm run varredura:check   # 1 busca — valida chave, datas e rede
npm run varredura         # 14 buscas, grava a série
npm run painel            # http://127.0.0.1:3060/varredura
```

## Armadilhas já pagas

**Não importe `src/cli.js` para "testar".** Importar executa a varredura
inteira (14 buscas) e grava. Para checar sintaxe: `node --check src/cli.js`.

**Teto do `arrival_id`.** Até ~10 aeroportos. Com 12 a API responde
`Google Flights hasn't returned any results for this query`, que parece
rota sem oferta mas é limite de contagem — testado com 12 destinos de alto
tráfego, mesmo erro. `carregarConfig()` valida o máximo de 8 no boot.

**Mais aeroportos não é mais cobertura.** O orçamento de ~40 itinerários é
por chamada. 7 aeroportos devolvem 6 destinos distintos; 10 devolvem 7.
Para cobrir mais, crie regiões, não encha as existentes.

**`price_insights` morre com destino múltiplo, não com origem múltipla.**
Medido nos dois sentidos. Por isso o gatilho usa `GRU,CGH,VCP` com um
destino só — cobre São Paulo inteira em 1 chamada e mantém o sinal.

**`price_insights` nem sempre existe.** Rotas sem histórico no Google
(visto em GRU→MEX) vêm sem o bloco mesmo com destino único. Não é bug.

**Nunca ordene por preço absoluto.** A América do Sul monopoliza a lista
todo dia e o destino "diferente" nunca aparece. O ranking útil é o desvio
da faixa típica da própria rota.

## Custo

Roda **todo dia às 9h** (crontab do claude-agent) com
`VARREDURA_GATILHO_TODAS=false`: 7 regiões + 1 gatilho em rodízio = 8 buscas.

| Configuração | Buscas/mês | Plano grátis (250) |
|---|---|---|
| Diária, gatilho em rodízio (atual) | ~248 | cabe, sem folga |
| Diária, todos os gatilhos (`true`) | ~430 | exige plano de US$ 25 |

Com rodízio, a faixa normal de cada região se renova a cada 7 dias; o painel
compara a faixa mais recente com o preço de hoje (que vem da descoberta,
diária) e mostra "faixa de dd/mm" quando ela não é do dia.

Sobra pouca cota: um `varredura:check` ou execução manual a mais no mês
pode estourar. Buscas em cache (1h) não contam.

## Histórico do Windows

A série coletada em 21/09 está em `C:\Users\lrocha\varredura-voos` na
máquina do usuário. Vale trazer: o `price_insights` do Google só cobre
~60 dias.

```sh
node scripts/importar-historico-windows.mjs /caminho/varredura-voos --dry-run
node scripts/importar-historico-windows.mjs /caminho/varredura-voos
```

Idempotente — linhas com mesma data+destino são ignoradas.
