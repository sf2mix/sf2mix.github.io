// Servidor de netplay compartilhado do site (EmulatorJS-Netplay).
// Obrigatoriamente https: o site roda em https no GitHub Pages e o navegador
// bloqueia o endpoint http/ws como mixed content.
// Deixe vazio para manter o botao oculto para os visitantes.
window.EJS_NETPLAY_SERVER = "https://sf2mix-github-io.onrender.com";

if (window.EJS_NETPLAY_SERVER) {
    window.EJS_netplayServer = window.EJS_NETPLAY_SERVER;
    window.EJS_EXPERIMENTAL_NETPLAY = true;
}
