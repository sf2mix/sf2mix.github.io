// Servidor de netplay compartilhado do site (EmulatorJS-Netplay).
// Obrigatoriamente https: o site roda em https no GitHub Pages e o navegador
// bloqueia o endpoint http/ws como mixed content.
// Deixe vazio para manter o botao oculto para os visitantes.

// Dentro de uma Discord Activity a pagina roda no proxy
// https://{clientId}.discordsays.com, que bloqueia qualquer dominio externo
// sem URL Mapping (erro blocked:csp). O Render serve o site inteiro e o relay
// na mesma origem, entonces aqui tudo vira mesmo-origin.
const NETPLAY_ACTIVITY = /\.discordsays\.com$/i.test(window.location.hostname);

if (NETPLAY_ACTIVITY) {
    window.EJS_NETPLAY_SERVER = window.location.origin;
    ["EJS_gameUrl", "EJS_gameParentUrl", "EJS_gamePatchUrl", "EJS_pathtodata", "EJS_backgroundImage"].forEach((key) => {
        const value = window[key];
        if (typeof value === "string" && value.startsWith("https://sf2mix.github.io/")) {
            window[key] = value.replace("https://sf2mix.github.io", "");
        }
    });
} else {
    window.EJS_NETPLAY_SERVER = "https://sf2mix-github-io.onrender.com";
}

if (window.EJS_NETPLAY_SERVER) {
    window.EJS_netplayServer = window.EJS_NETPLAY_SERVER;
    window.EJS_EXPERIMENTAL_NETPLAY = true;
}
