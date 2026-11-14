"use client";
import { useEffect } from "react";

// Mostra "‹" / "›" nas barras de abas que nao cabem na tela (celular): marca cada barra com can-left / can-right
// conforme ainda ha abas escondidas para um lado. O desenho das setas fica no CSS (.hs-on)
const SEL = ".subtabs, .tabs";
function update() {
  for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
    const over = el.scrollWidth > el.clientWidth + 2;
    el.classList.toggle("hs-on", over);
    el.classList.toggle("can-left", over && el.scrollLeft > 2);
    el.classList.toggle("can-right", over && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }
}
export default function ScrollHints() {
  useEffect(() => {
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    run();
    document.addEventListener("scroll", run, true); // captura a rolagem de qualquer barra
    window.addEventListener("resize", run);
    const mo = new MutationObserver(run); // abas que aparecem ao trocar de tela
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { document.removeEventListener("scroll", run, true); window.removeEventListener("resize", run); mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
