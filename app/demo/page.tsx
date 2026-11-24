import { notFound } from "next/navigation";
import Gallery from "./Gallery";

// Pagina de demonstracao: as pecas do visual novo e o painel com dados ficticios, sem login.
// So existe em desenvolvimento (npm run dev); no site publicado responde 404
export default function DemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
