# Servidor de netplay do sf2mix.github.io

Relay de [EmulatorJS 4.2.3](https://emulatorjs.org/docs4devs/netplay/) para o site
https://sf2mix.github.io/ — implementa os dois contratos que o client espera:

- `GET /list?domain=<host>&game_id=<EJS_gameID>` → `{ <sessionid>: { room_name, current, max, player_name, hasPassword } }`
- socket.io (EIO=4, path `/socket.io/`) com os eventos `open-room`, `join-room`, `leave-room`, `data-message`, `users-updated`

Esta pasta é subdiretório do repositório do site (`sf2mix.github.io/netplay`). O blueprint
`render.yaml` fica na **raiz** do repo e usa `rootDir: netplay`, porque o Render exige o
arquivo na raiz.

**Consequência de estar no mesmo repo:** todo push no `main` (inclusive mudança de PNG ou
ROM) dispara redeploy do servidor, e as salas vivem só em memória — partida em andamento cai.
Se isso incomodar, mover esta pasta para um repositório privado resolve.

## Upload para o GitHub

Rodar da raiz do repositório do site:

```bash
git add .
git status          # conferir: node_modules/ NAO deve aparecer (esta no .gitignore)
git commit -m "Servidor de netplay EmulatorJS + config do botao"
git push origin main
```

## Deploy no Render

1. Dashboard → **New + → Web Service** (não é Static Site nem Background Worker).
2. Conecte o repo `sf2mix/sf2mix.github.io`.
3. Dois caminhos, escolha um:
   - **Blueprint:** crie com "New + → Blueprint" apontando para o repo; o `render.yaml`
     da raiz já define `rootDir: netplay`, `plan: free`, `region: virginia`, build
     `npm ci --omit=dev`, start `node server.js` e health check `/healthz`.
   - **Manual:** no formulário do Web Service, abra **Advanced** e preencha
     *Root Directory* = `netplay`, *Build Command* = `npm ci --omit=dev`,
     *Start Command* = `node server.js`, *Health Check Path* = `/healthz`,
     *Instance Type* = **Free**.
4. Não mexa na porta: o Render injeta `PORT` e o código escuta em `process.env.PORT || 3000`.
5. Deploy. Você recebe algo como `https://sf2mix-netplay.onrender.com`.
6. Confira no navegador: `https://<sua-url>/healthz` → `{"ok":true,"rooms":0}`.
7. Preencha `data/netplay-config.js` com essa URL e publique:

   ```js
   window.EJS_NETPLAY_SERVER = "https://<sua-url>";
   ```

   Isso liga o botão de netplay nas 6 páginas de jogo de uma vez
   (sf2mix, sf2prime, sf2cre, avspd, sfz3mix, ssf2tnf).

## Manter acordado

O serviço grátis dorme após 15 min sem tráfego. Coloque um keep-alive batendo em
`/healthz` a cada 5 minutos (UptimeRobot, GitHub Action cron, qualquer monitor HTTP grátis).
O socket.io reconecta sozinho, mas a sala não — se o processo dormir no meio de uma
partida, ela é perdida.

## Testar local

```bash
cd netplay
npm install
PORT=3000 node server.js
```

Depois sirva o site em `http://localhost` e abra o jogo com o override de URL
(já implementado em `data/loader.js`):

```
http://localhost:8000/sf2cre.html?netplay=1&netplayServer=http://localhost:3000
```

`netplayServer` só é aceito em https, ou em http quando a página já é `http://localhost`
(regra anti mixed-content em `data/loader.js:89`).

## Notas

- `/list` filtra por `domain` **e** `game_id`: salas de outros sites que apontem para o
  mesmo servidor não aparecem na sua lista, e vice-versa.
- `MAX_ROOMS` (padrão 200) limita quantas salas existem ao mesmo tempo, para o processo
  não crescer além dos 512 MB do plano grátis.
- O handler `webrtc-signal` vem do upstream e fica inativo no 4.2.3 (que é relay puro);
  só passa a ser usado se um dia migrar para o 4.3.0-pre.
- Não existe autenticação. Qualquer pessoa que souber a URL pode criar sala — é o
  comportamento padrão do EmulatorJS.
- `netplay-local-test.html` e `netplay-2p-test.html` na raiz do repo são harness de teste
  local e estão no `.gitignore`.
