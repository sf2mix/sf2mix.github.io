# Netplay: de onde vem a lentidão e a falta de sincronia

Medição feita em 2026-10-30 com o harness de 2 jogadores (Chrome headless + CDP), dois
iframes na mesma máquina, e um probe de latência puro que não tem emulador no meio.
Nada aqui é inferido de documentação: todo número veio de uma execução local.

## Resumo

A lentidão tem **três causas independentes**, e o servidor grátis é só uma delas — e não
pelo motivo óbvio:

1. **O `data/emulator.min.js` publicado está podre.** Ele não sustenta o lockstep nem
   contra um relay a 1 ms de distância (35 fps, 65–70% do tempo parado). O mesmo código
   vindo de `data/src/*` roda a 60,2 fps com 0 stall nesse relay.
2. **O relay do Render fica longe, e isso não é culpa do "baixo desempenho".** São
   ~240 ms de caminho de ida (~485 ms de RTT), *fixos*, medidos também a 1 mensagem por
   segundo. Não é CPU throttled: se fosse, a latência cresceria com a taxa de mensagens,
   e ela não cresce. É distância + proxy de origem.
3. **O client tinha D (delay de input) travado em 10 frames.** Com 240 ms de ida, o
   anúncio chega depois do portão fechar, e o protocolo entra num poço sem volta: 33 fps,
   69% do tempo parado e **telas genuinamente diferentes** (22.725 pixels de 86.016).
   Agora o D é calculado da latência real medida pelo próprio client.

## Causa 1 — o bundle publicado

| código carregado | relay | fps | % do tempo parado | ressincronização | tela diverge |
|---|---|---|---|---|---|
| `data/emulator.min.js` (publicado, remendado à mão) | localhost, RTT ~1 ms | 35 | 65–70% | várias | sim |
| `data/emulator.sf2.js` (gerado de `data/src/*`) | localhost, RTT ~1 ms | 60,2 / 60,4 | 0% | 0 | não (`pxDiff 0`) |

O `emulator.min.js` remendado foi restaurado para o conteúdo do HEAD (md5
`b262e88ce912e75f3152a2f0dad86175`). A experiência de remendo manual ficou guardada em
`git stash` ("min-patch experimental"). O artefato certo é `data/emulator.sf2.js`, gerado
por script na mesma ordem de arquivos do `loader.js` em modo debug
(`emulator.js, nipplejs.js, shaders.js, storage.js, gamepad.js, GameManager.js,
socket.io.min.js, compression.js`) — assim o que o harness mede é literalmente o que a
página carrega via `EJS_paths`.

## Causa 2 — o que o relay grátis realmente custa

`netplay-relay-latency.js`: dois clientes socket.io reais no mesmo quarto, ping/pong de
aplicação, sem emulador, sem savestate, sem rAF. Estatísticas do ida-e-volta:

| configuração | relay localhost (controle) | Render (Oregon, free) |
|---|---|---|
| 1 msg/s de 16 B | mediana 0,9 ms (n=4) | mediana **493 ms** (n=6) |
| 10 msg/s de 16 B | mediana 1,0 ms | mediana 496 ms |
| 60 msg/s de 16 B | mediana 0,9 ms | mediana 489 ms (p99 651) |
| payload 1 KB — só a ida | 0,6 ms | **232 ms** |
| payload 64 KB — só a ida | 2,0 ms | 313 ms |
| payload 269 KB — só a ida (savestate RASTATE) | 8,3 ms | 587 ms (pior 1231 ms) |

Leitura: a latência é **plana em função da taxa de mensagens** (493 → 489 ms entre 1 e
60 msg/s). CPU espremida de free tier aparece como crescimento com a carga; aqui não
aparece. O que o Render free custa é ~240 ms de caminho de ida por causa da distância e do
proxy, mais um teto de transferência que só importa no resync (269 KB em ~0,6 s).

A latência de rede do caminho até a origem foi a mesma vista no HTTP: `curl` com TCP
connect de 50–174 ms e TTFB de 377–848 ms.

## Causa 3 — o poço do frame-delay

Cada lado só executa o frame F depois de receber do colega o anúncio de que ele já mandou
tudo que carimba F. O anúncio sai com `D-1` frames de antecedência, então `D-1` frames de
chumbo precisam cobrir a latência de ida + jitter. Com `D = 10` o chumbo é 150 ms e a ida
real é 240 ms: o portão fecha antes do anúncio chegar, e como o portão só **bloqueia**
(nunca rebobina), o relógio dos dois lados fica permanentemente desencontrado.

Assinatura no trace: `deficit = anúncio_do_colega − meu_relogio` mediano em **−1**
(poço) contra **+5/+19** (saudável).

Medido no Render com o MESMO código, variando só o D:

| D | fps (A/B) | % parado do host | % parado do guest | tela diverge | lag de input |
|---|---|---|---|---|---|
| 10 fixo | 33,2 / 33,4 | 69% | 68% | **sim** (pxDiff 22.725) | 167 ms |
| adaptativo, folga 4 → D 22 | 60,3 / 59,8 | 0% | 14% | não | 367 ms |
| 26 fixo | 60,1 / 59,9 | 0% | 7% | não | 433 ms |
| 30 fixo | 60,2 / 59,7 | 0% | 5% | não | 500 ms |
| **adaptativo, folga 10 → D 28** | **60,2 / 59,9** | **0%** | **3%** | não (`pxDiff 0`, estado 0) | 467 ms |

Ou seja: contra o Render, um `D` grande não é conforto, é **o que impede a tela de
divergir**. O custo real é o lag de input (~470 ms), e esse custo é da distância até o
servidor, não do código.

## O que foi mudado no client (`data/src/emulator.js`)

- **Fix 1 — polling do stall de 20 ms para 4 ms.** Com 20 ms o ida-e-volta custava ~40 ms
  por frame e o jogo rodava a 36 fps mesmo com relay a 1 ms.
- **Fix 2 — contador embutido no savestate.** O RASTATE (269.216 bytes) carrega em offset
  16 o próprio contador de frames executados, e o `load_state` **não** restaura esse
  campo. É ele, e não o `getFrameNum()`, que tem que bater entre as duas máquinas.
  `embeddedCounter()` lê, `alignEmbedded()` alinha antes de carregar, e o `ready` do guest
  devolve o contador alinhado. Verificado: `echo.diff 0`, cabeçalho idêntico nos dois
  lados, `stateCompare.diff 0` nos 269.216 bytes, `pxDiff 0`.
- **Fix 3 — sonda de RTT no nível da aplicação + D adaptativo.** O socket.io vendorizado
  não expõe latência nenhuma (`socket.latency` e `socket.ping` medidos dando 0 nos dois
  lados), então o client manda `{ping}` a cada 300 ms e o par devolve `{pong}` com o mesmo
  `at`; usa `performance.now()` porque no relay local o ida-e-volta é submilissegundo.
  `D = min(30, max(piso, ceil(RTT/2 em frames) + folga))`, com folga 4 em link local e 10
  em link remoto; `performance.now()` em vez de média móvel simples porque um pico isolado
  não pode travar o D para sempre. O D adotado viaja no marcador (`d:`) e o receptor
  adota o máximo, então os dois lados terminam com o mesmo D.
- Knob de medição: `window.EJS_netplayInputDelayFixed = 1` trava o D no valor do piso, só
  para o A/B acima.

## Como reproduzir

```sh
# servidor de assets (threaded) e relay local
python -m http.server 8000
PORT=3000 node netplay/server.js

# bundle verificado, gerado de data/src/*
node build_sf2_bundle.js   # (script fora do repo; gera data/emulator.sf2.js)

# harness 2P no bundle: ?sf2=1, ?inDelay=N e ?fixedD=1 controlam o D
NP_PAGE="http://localhost:8000/netplay-2p-test.html?sf2=1" \
NP_RELAY="https://sf2mix-github-io.onrender.com" \
  node netplay-headless-test.js --late=9 --secs=14

# latência pura do relay, sem emulador
node netplay-relay-latency.js --url=http://localhost:3000 --secs=4   # controle
node netplay-relay-latency.js                                       # Render
```

## Pendências honestas

- Nada disso está publicado. `data/emulator.min.js` continua igual ao que está no ar; a
  troca pelo `emulator.sf2.js` (ou apontar `EJS_paths` para ele) é decisão de deploy.
- O lag de ~470 ms contra o Render é físico. As alternativas reais: relay mais perto do
  jogador, P2P por WebRTC (o `netplay/server.js` já encaminha `webrtc-signal`, mas o
  client não tem uma linha de RTCPeerConnection — é trabalho novo), ou rollback, que é o
  que resolveria de verdade e é projeto grande.
- Um artefato de medição ficou explicado, não corrigido: no `screenLate`, se um ressincro
  acontece durante o congelamento forçado do harness, os dois PNGs deixam de ser do mesmo
  instante e a diferença de pixels explode (`pxDiff 85.440` com `stateDiff 0`, que é
  exatamente a assinatura de captura errada, não de simulação). O harness agora reporta
  `reanchorA/B`, `syncPedido`, `resyncAplicado` e `reTake` para isso não ser lido como
  desync.
