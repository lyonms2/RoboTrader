// Onde ficam os dados de quem esta logado no navegador.
// Dono (o e-mail das regras do Firestore / ALLOWED_EMAIL): na raiz do banco, como sempre foi (config/main, trades...).
// Membro (e-mail cadastrado em access/{email}): no espaco dele, users/{uid}/config/main, users/{uid}/trades...
// Dados gerais (sinais do robo em latest/*) continuam na raiz e nao passam por aqui.
let BASE = "";
export const setDataBase = (b: string) => { BASE = b; };
export const P = (path: string) => BASE + path;
export const memberBase = (uid: string) => `users/${uid}/`;
