// Integracion Discord Activity para el netplay del sf2mix.
// Corre solo dentro del proxy de Activities ({clientId}.discordsays.com) o con
// ?activityMock=1 (probar local sin Discord). Abre automaticamente una sala de
// netplay por canal: el primero en cargar el juego es Host, los demas se unen.
(() => {
    const IS_ACTIVITY = /\.discordsays\.com$/i.test(window.location.hostname);
    const IS_MOCK = new URLSearchParams(window.location.search).has("activityMock");
    if (!IS_ACTIVITY && !IS_MOCK) return;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (cond, timeoutMs = 180000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const value = cond();
            if (value) return value;
            await sleep(500);
        }
        return null;
    };

    async function boot() {
        let channelKey;
        let isMockHost = false;
        if (IS_MOCK) {
            channelKey = "LOCALMOCK";
            isMockHost = new URLSearchParams(window.location.search).get("mockRole") === "host";
        } else {
            const { DiscordSDK } = await import("./discord-embedded-app-sdk.mjs");
            const sdk = new DiscordSDK(window.location.hostname.split(".")[0]);
            await sdk.ready();
            channelKey = sdk.channelId || sdk.guildId;
        }
        if (!channelKey) {
            //Lanzada fuera de un canal con contexto: dejo el menu manual de siempre.
            return;
        }
        const emu = await waitFor(() => (window.EJS_emulator && window.EJS_emulator.openNetplayMenu) ? window.EJS_emulator : null);
        if (!emu) return;
        //Esperar núcleo cargado: loadState y saveState fallan antes de start().
        await waitFor(() => emu.started);
        //El menu de netplay inicializa this.netplay de forma perezosa.
        emu.openNetplayMenu();
        emu.netplayMenu.style.display = "none";
        if (!emu.netplay || !emu.netplay.openRoom) return;

        const roomName = "SF2MIX-" + channelKey;
        const maxPlayers = parseInt(window.EJS_netplayMaxPlayers || "2", 10);
        emu.netplay.name = "P-" + Math.floor(100 + Math.random() * 900);

        for (let attempt = 1; attempt <= 3; attempt++) {
            //Jitter: sin esto, dos personas que entran a la vez abren salas distintas.
            await sleep((isMockHost ? 2000 : 200) + Math.random() * 700);
            if (emu.isNetplay) return;
            const open = await emu.netplay.getOpenRooms().catch(() => ({}));
            const found = Object.entries(open).find(([, room]) => room.room_name === roomName);
            if (found) {
                emu.netplay.joinRoom(found[0], roomName);
                return;
            }
            if (attempt === 3) {
                emu.netplay.openRoom(roomName, maxPlayers, "");
            }
        }
    }

    boot().catch((e) => console.warn("[discord-activity]", e));
})();
