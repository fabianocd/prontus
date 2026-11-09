import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { extractionQuotaSchema, quotaNotice } from "@/lib/templates/extraction-limit";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Novo modelo" };

export default function NewTemplatePage() {
  return (
    <>
      <PageHeader
        back={{ href: "/modelos", label: "Modelos" }}
        title="Novo modelo"
        description="Envie 1 PDF ou até 10 fotos da ficha em branco (máx. 20 MB). A IA monta um rascunho das seções e campos para você revisar. Nunca envie fichas preenchidas com dados de pacientes."
      />
      <div className="max-w-3xl">
        <Suspense fallback={<Skeleton className="h-80 rounded-3xl" />}>
          <UploadSection />
        </Suspense>
      </div>
    </>
  );
}

async function UploadSection() {
  const { user, supabase } = await requireUser();
  const { data } = await supabase.rpc("get_extraction_quota");
  const quota = extractionQuotaSchema.safeParse(data);
  // Se a consulta falhar, a rota ainda confere o limite antes de ler.
  return <UploadForm userId={user.id} quotaNotice={quota.success ? quotaNotice(quota.data) : null} />;
}
