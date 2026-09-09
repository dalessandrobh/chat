import { BloqueiosClient } from "@/components/bloqueios/BloqueiosClient";

// A lista muda quando alguém bloqueia de outra tela; cache não ajuda.
export const dynamic = "force-dynamic";

export default function BloqueiosPage() {
  return (
    <div className="h-full overflow-y-auto">
      <BloqueiosClient />
    </div>
  );
}
