// Onde ficam os dados de quem esta logado no navegador.
// Dono (o e-mail das regras do Firestore / ALLOWED_EMAIL): na raiz do banco, como sempre foi (config/main, trades...).
// Membro (e-mail cadastrado em access/{email}): no espaco dele, users/{uid}/config/main, users/{uid}/trades...
// Dados gerais (sinais do robo em latest/*) continuam na raiz e nao passam por aqui.
let BASE = "";
export const setDataBase = (b: string) => { BASE = b; };
export const P = (path: string) => BASE + path;
export const memberBase = (uid: string) => `users/${uid}/`;
// Modo suporte: o dono esta vendo a conta de um membro, so leitura
let READ_ONLY = false;
export const setReadOnly = (v: boolean) => { READ_ONLY = v; };
export const isReadOnly = () => READ_ONLY;
