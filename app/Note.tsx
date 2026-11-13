// Explicacao de um quadro: fica fechada em "como funciona" para nao poluir a tela
export default function Note({ children, label = "como funciona" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="note">
      <summary><span className="note-i" aria-hidden="true">i</span>{label}</summary>
      <div className="note-body">{children}</div>
    </details>
  );
}
