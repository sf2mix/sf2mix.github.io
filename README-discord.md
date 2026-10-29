# SF2Mix como Discord Activity

Abre `sf2mix.html` (e os outros jogos com netplay) dentro de um canal do Discord.
Quem lança a Activity vira **Host** e quem entra depois no mesmo canal entra como
**Guest** na sala automaticamente — o roteiro de sala é keyed pelo `channelId`.

## Como funciona (resumo técnico)

- O Discord carrega o site num iframe através do proxy de Activities:
  `https://{clientId}.discordsays.com/caminho`. **Todo domínio usado pela página
  precisa estar registrado em Activities → URL Mappings**, senão o iframe é
  bloqueado (`blocked:csp`). Por isso o serviço do Render passou a servir o
  repo inteiro ( Relay + site na mesma origem), e o mapping é um único prefixo `/`.
- `data/netplay-config.js` detecta `*.discordsays.com`: o servidor de netplay
  vira `window.location.origin` (o socket.io sai pelo proxy, que suporta
  **somente WebSocket** — o relay EmulatorJS usa socket.io, então funciona) e as
  URLs `https://sf2mix.github.io/...` viram caminhos relativos.
- `data/discord-activity.js` roda só dentro do proxy (ou com `?activityMock=1`):
  espera o core iniciar, chama `openNetplayMenu()` (oculta o menu), monta o nome
  da sala `SF2MIX-<channelId>` e entra — se a sala já existe, entra como Guest;
  na 3ª tentativa sem achar sala, abre como Host. Sem bot e sem backend OAuth.

## 1. Deploy no Render (site + relay)

O repo já tem [render.yaml](render.yaml): serviço Node `sf2mix-netplay`,
`rootDir: netplay`, `startCommand: node server.js`, health check `/healthz`.
Se o serviço já existe (como hoje), **nada muda no painel** — o `server.js`
agora também serve o site estaticamente a partir do root do repo
(`express.static(path.join(__dirname, '..'))`).

Passos (só se ainda não houver serviço):
1. Render Dashboard → New → Web Service → conectar o repo `sf2mix.github.io`.
2. Root Directory = `netplay` · Build = `npm ci --omit=dev` · Start = `node server.js`.
3. Após o deploy, confirme: `https://<serviço>.onrender.com/sf2mix.html` deve abrir o jogo.

Atenção: cada redeploy derruba as salas de netplay ativas.

## 2. Discord Developer Portal

1. https://discord.com/developers/applications → **New Application** → nome `SF2Mix`.
2. Copie o **Application ID** (é o `clientId`; aparece na barra de endereço do portal).
3. **Installation**: Contexts = User + Guild; Install Type = **Guild + Direct Message** (ou apenas User — não é necessário criar bot).
4. **OAuth2 → General**: adicione um Redirect placeholder `https://127.0.0.1` (o campo é obrigatório no portal, mas o fluxo da Activity não usa redirect).
5. **Activities**:
   - **Enable Activities**: marque a primeira caixa da página e salve. Isso cria sozinho o entry point **"Launch"** nos canais.
   - **URL Mappings → New**: Prefixo `/` → domínio `sf2mix-github-io.onrender.com`
     **sem protocolo e sem barra final** (a doc exige: o target não inclui `https://` e precisa apontar para um diretório). Um único mapping na raiz cobre o site todo.
   - **Application URL Override**: deixe **desligado** — é apenas para túnel/localhost em desenvolvimento.
   - Salvar e aguardar propagar (podem ser precisos alguns minutos e reabrir o Discord).
6. **Informações gerais**: nome/descrição/tags não afetam o funcionamento. O campo Tags pode travar o salvamento com `tags: 0`; para Activity privada basta ignorar essa aba.
7. **Rich Presence → Art Assets**: opcional, suba um `icon.png` para o card da Activity.

## 2.1 Uso sem verificação (Activity privada)

Lançar uma Activity **não distribuída** é limitado ao dono do app e a membros da equipe de desenvolvimento. Para liberar os visitantes do seu servidor sem verificação/listagem: adicione-os em **Testers de apps**, ou instale o app no servidor pelo link da aba **Installation** (contexto Guild, sem escopo de bot) e cole o link no canal. Teste com uma pessoa antes de escolher.

No cliente, ative **Modo Desenvolvedor** (Configurações do usuário → Avançado) para enxergar a prateleira de Activities no canal de voz (botão do foguete).

## 3. Uso

1. No servidor, abra um **canal de voz** (ou texto) → `+` / Aba Apps → **SF2Mix**.
2. A página do jogo carrega dentro do Discord; após o core iniciar, a sala
   `SF2MIX-<id-do-canal>` é criada/aberta automaticamente (Host = quem lançou primeiro).
3. Os demais participantes lançam a mesma Activity **no mesmo canal** → entram na sala como Guest.
4. Se a auto-sala falhar (SDK sem `channelId`, rede), o menu manual de netplay continua acessível.

## 4. Limitações conhecidas

- **Latência**: o netplay EmulatorJS usa save-state + input delay de 20 frames (~333 ms). Não há rollback, então a sensação é de "atraso de fliperama com cabo longo" — bom para VS casual, não para combo practice.
- **Áudio**: o iframe inicia sem gestos do usuário; em alguns clientes o som só liga após um clique dentro da Activity.
- **Fullscreen / controles touch**: instáveis dentro do iframe do Discord; o layout do jogo já dimensiona 640×480.
- **Proxy só WebSocket**: qualquer recurso WebRTC não funcionaria via discordsays (não usamos).
- **Free tier do Render**: o serviço dorme após inatividade; a primeira conexão pode levar ~30 s (considerar keep-alive na GitHub Action, pendente).
- **Vários jogos**: `sf2mix`, `sf2prime`, `sf2cre`, `avspd`, `sfz3mix` já apontam para o mesmo script; `ssf2tnf` não tem netplay e ficou de fora.

## 5. Teste local (sem Discord)

```
node netplay/server.js                 # relay + site no :3000 (ou use python -m http.server p/ o site)
python -m http.server 8080             # site + harness
```

Abra `http://localhost:8080/netplay-2p-test.html?min=1&netplayServer=http://localhost:3000&activityMock=1`
— os dois iframes simulam Host (`mockRole=host`) e Guest (`mockRole=guest`) e o
auto-join roda de verdade contra o relay local. O mesmo harness, sem
`activityMock`, testa o caminho manual.

## Arquivos envolvidos

- [data/discord-activity.js](data/discord-activity.js) — auto-sala por canal.
- [data/discord-embedded-app-sdk.mjs](data/discord-embedded-app-sdk.mjs) — SDK oficial embutido (vendored, `@discord/embedded-app-sdk@2.5.0`).
- [data/netplay-config.js](data/netplay-config.js) — origem do relay conforme o ambiente.
- [netplay/server.js](netplay/server.js) — relay socket.io + static do site.
- `sf2mix.html`, `sf2prime.html`, `sf2cre.html`, `avspd.html`, `sfz3mix.html` — caminhos relativos + include do `discord-activity.js`.
