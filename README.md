# viagens

Varredura de passagens internacionais saindo de São Paulo (SerpApi /
Google Flights), com série histórica e painel web.

```sh
npm ci && cp .env.example .env   # preencha SERPAPI_KEY
npm test
npm run varredura:check          # 1 busca
npm run varredura                # 9 a 16 buscas, grava a série
npm run painel                   # http://127.0.0.1:3060/varredura
```

- [docs/handoff.md](docs/handoff.md) — estado, pendências, armadilhas
- [docs/varredura.md](docs/varredura.md) — decisões e limites medidos da API
