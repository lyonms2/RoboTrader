"use client";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuracao publica do app web (Firebase > Configuracoes do projeto > Seus apps > Web).
// As variaveis NEXT_PUBLIC_* entram no codigo durante o build: depois de cadastra-las na Vercel, faca Redeploy.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

// Inicializa so no navegador, na primeira chamada (o build pre-renderiza a pagina no servidor)
function app(): FirebaseApp {
  return getApps().length ? getApps()[0] : initializeApp(config);
}

export const auth = () => getAuth(app());
export const db = () => getFirestore(app());
