/**
 * Medidor de latencia PURA do relay, sem emulador no meio.
 *
 * O harness de 2 jogadores (netplay-headless-test.js) mostra o RTT que o lockstep sente,
 * mas ali tem core, rAF e savestate junto. Este script liga dois clientes socket.io
 * verdadeiros no mesmo quarto e faz ping/pong de aplicacao entre eles, variando apenas a
 * frequencia e o tamanho da mensagem. Isso separa as duas hipoteses de "servidor gratis de
 * baixo desempenho":
 *   - CPU throttled (cota de 0,1 CPU): a latencia CRESCE com a frequencia de mensagens;
 *   - caminho de rede / proxy fixo: a latencia e a MESMA a 1 msg/s e a 60 msg/s.
 *
 * Uso:
 *   node netplay-relay-latency.js                                   # Render (padrao)
 *   node netplay-relay-latency.js --url=http://localhost:3000       # relay local (controle)
 *   node netplay-relay-latency.js --rates=1,10,60 --secs=6
 *   node netplay-relay-latency.js --big=1024,65536,269216           # transferencia pesada
 */

const IO = require("./netplay/node_modules/socket.io-client");

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=")[1] : dflt;
};

const URL_RELAY = arg("url", "https://sf2mix-github-io.onrender.com");
const RATES = arg("rates", "1,10,60").split(",").map(Number);
const BIG = arg("big", "1024,65536,269216").split(",").map(Number);
const SECS = Number(arg("secs", "6"));
const SMALL = Number(arg("small", "16"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;

function stats(list) {
    if (!list.length) return { n: 0 };
    const s = list.slice().sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    return {
        n: s.length,
        min: +s[0].toFixed(1),
        mediana: +q(0.5).toFixed(1),
        p90: +q(0.9).toFixed(1),
        p99: +q(0.99).toFixed(1),
        max: +s[s.length - 1].toFixed(1),
    };
}

function connect(tag) {
    const socket = IO(URL_RELAY, {
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
    });
    socket.__tag = tag;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${tag}: timeout de conexao`)), 30000);
        socket.on("connect_error", (e) => { clearTimeout(timer); reject(new Error(`${tag}: ${e.message}`)); });
        socket.on("connect", () => { clearTimeout(timer); resolve(socket); });
    });
}

const room = `probe-${Date.now()}`;

async function main() {
    console.log(`relay = ${URL_RELAY}   janela = ${SECS}s por config`);
    const A = await connect("A");
    const B = await connect("B");

    await new Promise((res, rej) =>
        A.emit("open-room", { extra: { sessionid: room, userid: "probeA", player_name: "probeA", room_name: room, game_id: "probe" }, maxPlayers: 2 }, (err) => (err ? rej(new Error(`open-room: ${err}`)) : res()))
    );
    await new Promise((res, rej) =>
        B.emit("join-room", { extra: { sessionid: room, userid: "probeB", player_name: "probeB" } }, (err) => (err ? rej(new Error(`join-room: ${err}`)) : res()))
    );
    console.log(`quarto ${room} aberto, 2 clientes via websocket\n`);

    // B = ecoador: devolve pong com o mesmo `at` que recebeu, como faz o client do jogo
    B.on("data-message", (d) => {
        if (d && d.ping !== undefined) B.emit("data-message", { pong: d.ping, at: d.at, echoPad: d.pad });
        if (d && d.big === undefined && d.req === undefined) { /* outros tipos: ignora */ }
    });

    const resultados = [];

    for (const rate of RATES) {
        const rtts = [];
        let seq = 0;
        const out = new Map();
        const onData = (d) => {
            if (d && d.pong !== undefined && out.has(d.pong)) {
                rtts.push(now() - out.get(d.pong));
                out.delete(d.pong);
            }
        };
        A.on("data-message", onData);
        const pad = "x".repeat(SMALL);
        const t0 = now();
        const envio = SECS * rate;
        for (let i = 0; i < envio; i++) {
            const s = ++seq;
            out.set(s, now());
            A.emit("data-message", { ping: s, at: out.get(s), pad });
            await sleep(1000 / rate);
        }
        await sleep(Math.min(3000, 20000 / rate));
        A.off("data-message", onData);
        const st = stats(rtts);
        resultados.push({ cfg: `${rate} msg/s x ${SMALL}B`, ...st, enviados: envio });
        console.log(`${String(rate).padStart(3)} msg/s de ${SMALL}B  ->  ${JSON.stringify(st)} (enviados ${envio}, janela ${((now() - t0) / 1000).toFixed(1)}s)`);
    }

    // mensagens grandes: e throughput (tempo de transferencia) ou so latencia?
    for (const size of BIG) {
        const rtts = [];
        const transfer = [];
        let seq = 0;
        const out = new Map();
        const onData = (d) => {
            if (d && d.pong !== undefined && out.has(d.pong)) {
                rtts.push(now() - out.get(d.pong));
                out.delete(d.pong);
            }
        };
        A.on("data-message", onData);
        // eco para payload grande: B precisa devolver o mesmo tamanho, senao medimos so a ida
        const echoBig = (d) => {
            if (d && d.heavy !== undefined) {
                transfer.push([d.heavy, now() - d.at]);
                // devolve um pong vazio (sem repetir o payload): assim rtts = ida-e-volta com
                // payload grande SO NA IDA, e transfer = caminho de ida medido no B
                B.emit("data-message", { pong: d.heavy, at: d.at, size: d.size });
            }
        };
        B.on("data-message", echoBig);
        const pad = "y".repeat(size);
        const n = size > 100000 ? 8 : 20;
        for (let i = 0; i < n; i++) {
            const s = ++seq;
            out.set(s, now());
            A.emit("data-message", { heavy: s, at: out.get(s), size, pad });
            await sleep(250);
        }
        await sleep(3000);
        B.off("data-message", echoBig);
        A.off("data-message", onData);
        const st = stats(rtts);
        const ida = stats(transfer.map((x) => x[1]));
        console.log(`payload ${String(size).padStart(6)}B x${n}  ->  ida-e-volta ${JSON.stringify(st)}  so-ida ${JSON.stringify(ida)}`);
        resultados.push({ cfg: `${size}B x${n}`, ...st, soIda: ida });
    }

    A.close();
    B.close();
    console.log("\nresumo:");
    console.log(JSON.stringify(resultados, null, 1));
}

main().catch((e) => {
    console.error("ERRO:", e.message || e);
    process.exit(1);
});
