# Varredura de passagens

Monitora preços de voos internacionais saindo de São Paulo para uma janela
de datas fixa, acumula série histórica e sinaliza quando um destino está
fora do padrão.

```bash
npm run varredura:check     # 1 busca: valida chave, datas e rede
npm run varredura           # varre, grava e imprime o relatório
npm run varredura:dry       # não grava nada (útil pra testar config)
npm run varredura:check     # 1 busca: valida chave, datas e rede
npm run painel              # painel web em http://127.0.0.1:3060/varredura
npm test                    # 16 testes, sem rede
```

## Como funciona

Duas camadas, e a razão de serem duas está em [Limites da API](#limites-da-api).

| Camada | Chamadas | Traz |
|---|---|---|
| **Descoberta** | 1 por região (7) | preço de cada destino |
| **Gatilho** | 1 por destino | `price_insights` + comparação entre companhias |

A descoberta varre largo e barato. O gatilho aprofunda nos destinos que
valem olhar.

## Limites da API

Medidos contra a API real, não deduzidos da documentação. São eles que
explicam o desenho:

**1. `arrival_id` aceita no máximo ~10 aeroportos.** Com 12 a resposta é
`Google Flights hasn't returned any results for this query`. Testado também
com 12 destinos de alto tráfego — o erro é de contagem, não de rota sem
oferta. O código usa 8, com margem, e `config.js` valida isso no boot.

**2. O orçamento de itinerários é por chamada, não por aeroporto.**

| Aeroportos pedidos | Itinerários | Destinos distintos |
|---|---|---|
| 3 | 26 | 3 |
| 7 | 40 | 6 |
| 10 | 41 | 7 |

Os resultados saturam em ~40. Passar de 8 aeroportos por chamada não
aumenta a cobertura: os destinos só disputam os mesmos slots. Para cobrir
mais, divida em mais regiões — cada chamada tem seu próprio orçamento.

Foi por isso que Ásia e Oriente Médio viraram regiões separadas: juntos,
Istambul e Dubai consumiam a chamada e Tóquio, Seul e Bangcoc nunca
apareciam. Mesmo motivo para Europa Ibérica/Mediterrâneo vs. Centro/Norte,
e para Havaí ficar no Pacífico em vez da América do Norte — contra Cancún
ele nunca surgiria.

**3. Vários destinos numa chamada anulam o `price_insights`.** Vários
**origens** não.

```
GRU         → EZE,SCL,MVD   price_insights AUSENTE
GRU,CGH,VCP → EZE           price_insights PRESENTE
```

Por isso o gatilho mantém `GRU,CGH,VCP` e consulta um destino por vez:
cobre São Paulo inteira em 1 chamada, sem perder o sinal.

**4. `price_insights` nem sempre existe,** mesmo com destino único — rotas
sem histórico no Google (observado em GRU→MEX) vêm sem o bloco. Para essas,
a detecção de anomalia depende do histórico local.

**5. Buscas em cache são grátis** e não contam na cota. O cache dura 1h, o
que não ajuda um job diário mas torna o desenvolvimento barato.

## Por que não ordenar por preço absoluto

Ranquear por valor faz a América do Sul monopolizar a lista todo dia:
Buenos Aires a R$ 3.140 sempre ganha de Tóquio a R$ 9.800. O destino
"diferente" que o monitoramento existe para achar nunca apareceria.

O `price_insights` resolve isso dando a faixa típica **daquela rota**:

```
Buenos Aires   R$ 3.140   faixa normal R$ 1.250–2.600   → 21% acima
Assunção       R$ 2.382   faixa normal R$ 1.700–2.900   → dentro
```

Mais barato não é o mesmo que boa oportunidade. O painel lidera com
onde o preço cai **na faixa da rota**, não com o que é barato.

Pelo mesmo motivo o gatilho pega **1 por região** em vez dos N mais baratos
no geral — senão as 7 chamadas iriam todas para a América do Sul.

## Custo

14 buscas por execução com `VARREDURA_GATILHO_TODAS=true` (7 regiões + 7
gatilhos).

| Frequência | Buscas/mês | Plano grátis (250) |
|---|---|---|
| Diária | 420 | estoura por volta do dia 18 |
| Dia sim, dia não | 210 | cabe |
| Diária, plano US$ 25 (1.000) | 420 | cabe com folga |

Com `VARREDURA_GATILHO_TODAS=false` são 8 buscas/execução e as regiões se
revezam no gatilho, cobrindo todas a cada 7 dias.

## Dados

Gravados em `VARREDURA_DATA_DIR`, **fora da árvore do código**, para
sobreviver a deploy e rebuild de container.

| Arquivo | Conteúdo |
|---|---|
| `precos.csv` | uma linha por destino por execução |
| `insights.csv` | faixa normal e veredito por execução |
| `historico.json` | série por destino (400 pontos), usada no cálculo de quedas |

Os CSV usam `;` como separador, que é o que o Excel em pt-BR espera.

## Agendamento

```cron
# crontab do claude-agent (CRON_TZ=America/Sao_Paulo no topo) — dia sim, dia não, às 9h
0 9 */2 * * cd /home/claude-agent/tasks/viagens && /usr/bin/node src/cli.js >> logs/varredura.log 2>&1
```

## Configurar regiões

`src/config.js`, constante `REGIOES`. Máximo de 8 aeroportos por
região — acima disso `carregarConfig()` lança erro no boot, em vez de
falhar silenciosamente na chamada. Códigos novos entram em `CIDADES`;
código desconhecido cai de volta para a sigla, sem quebrar.

## Painel web

`npm run painel` sobe `src/servidor.js`, que serve `GET /varredura`
(`src/painel.js` + `painel.html`). Em produção roda pelo systemd
(`deploy/viagens-painel.service`). Só lê `VARREDURA_DATA_DIR`, não chama a SerpApi. Mostra:

- **Hoje × faixa normal** — onde o preço do gatilho cai na faixa típica,
  cada linha na escala da própria rota.
- **Todos os destinos** — mais barato, mais rápido e o **razoável**: o mais
  barato entre as opções que levam até N× o voo mais rápido *daquela rota*
  (N ajustável, padrão 1,5). Limite fixo de horas não funciona: 25h para
  Tóquio é normal, 12h para Buenos Aires não.
- **Histórico** — `price_history` do Google (linha) + nossas execuções
  (pontos) sobre a faixa normal.

Arquivos extras gravados por execução para alimentá-lo:

| Arquivo | Conteúdo |
|---|---|
| `ultima.json` | snapshot completo da última execução, com todas as opções de cada destino (preço, duração, paradas, cia) |
| `google.json` | `price_history` por destino, mesclado por data — cresce além dos ~60 dias do Google |

Exposto em `https://viagens.privateequitybrasil.site` pelo túnel
`82bc0bec` (`~/.cloudflared/config.yml`, unit `cloudflared-mockup`).
Protegido por link secreto: `/?k=<PAINEL_TOKEN>` grava um cookie de 1 ano
e redireciona; sem ele, 401. O servidor continua escutando só em
`127.0.0.1` — o acesso de fora passa pelo túnel.
