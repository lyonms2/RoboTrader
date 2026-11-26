"use client";
// Preferencia do membro: usa criptomoedas? (false = esconde carteira, cotacoes, categorias e ajuda de cripto)
import { createContext, useContext } from "react";

export const ShowCrypto = createContext(true);
export const useShowCrypto = () => useContext(ShowCrypto);
export const CRYPTO_CATS = ["Compra de cripto", "Venda de cripto"];
