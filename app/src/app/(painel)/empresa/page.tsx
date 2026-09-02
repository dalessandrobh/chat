import { EmpresaClient } from "@/components/empresa/EmpresaClient";

export const dynamic = "force-dynamic";

export default function EmpresaPage() {
  return (
    <div className="h-full overflow-y-auto">
      <EmpresaClient />
    </div>
  );
}
