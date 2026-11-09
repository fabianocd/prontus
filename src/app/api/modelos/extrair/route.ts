import type { NextRequest } from "next/server";
import {
  ExtractionError,
  extractTemplateWithGemini,
  type ExtractionErrorCode,
  type ExtractionFile,
} from "@/lib/gemini/extract-template";
import { DOCS_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import {
  extractRequestSchema,
  type ExtractResponse,
} from "@/lib/templates/extract-api";
import { blockedMessage, extractionQuotaSchema } from "@/lib/templates/extraction-limit";
import { normalizeTemplate, normalizeTitle } from "@/lib/templates/normalize";
import { checkUpload, resolveMime, sourceFolder } from "@/lib/uploads";

// A leitura de uma ficha longa pode levar dezenas de segundos.
export const maxDuration = 120;

const STATUS: Record<ExtractionErrorCode, number> = {
  not_configured: 500,
  quota: 429,
  unavailable: 503,
  unreadable: 422,
  invalid_response: 502,
  not_anamnesis: 422,
  empty: 422,
};

function reply(body: ExtractResponse, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function failure(code: string, message: string, status: number) {
  return reply({ ok: false, code, message }, status);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) {
    return failure("unauthorized", "Sua sessão expirou. Entre de novo para continuar.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = extractRequestSchema.safeParse(body);
  if (!parsed.success) return failure("bad_request", "Requisição inválida.", 400);

  // Lista com o cliente do usuário: o RLS do storage só mostra a própria pasta.
  const folder = sourceFolder(userId, parsed.data.uploadId);
  const bucket = supabase.storage.from(DOCS_BUCKET);
  const { data: items, error: listError } = await bucket.list(folder, {
    limit: 20,
    sortBy: { column: "name", order: "asc" },
  });
  if (listError) {
    return failure("storage", "Não foi possível acessar o arquivo enviado. Tente de novo.", 500);
  }

  const files = (items ?? [])
    .filter((item) => item.id !== null)
    .map((item) => ({
      path: `${folder}/${item.name}`,
      name: item.name,
      type: String(item.metadata?.mimetype ?? ""),
      size: Number(item.metadata?.size ?? 0),
    }));

  const removeUpload = () => bucket.remove(files.map((file) => file.path));

  if (files.length === 0) {
    return failure("not_found", "Arquivo não encontrado. Envie a ficha de novo.", 404);
  }

  const check = checkUpload(files);
  if (!check.ok) {
    await removeUpload();
    return failure("invalid_upload", check.message, 400);
  }

  // Limite por conta (10/h, 30/dia): a cota do Gemini é compartilhada pelo app.
  // Conta toda leitura que chega ao Gemini, mesmo se ele falhar.
  const { data: claim, error: claimError } = await supabase.rpc("claim_extraction");
  const quota = extractionQuotaSchema.safeParse(claim);
  if (claimError || !quota.success) {
    console.error("Falha ao conferir o limite de leituras", claimError ?? quota.error);
    return failure("unexpected", "Algo deu errado ao ler a ficha. Tente de novo.", 500);
  }
  if (!quota.data.allowed) {
    await removeUpload();
    return reply(
      { ok: false, code: "rate_limited", message: blockedMessage(quota.data) },
      429,
      { "Retry-After": String(quota.data.retry_after_seconds) },
    );
  }

  const downloads: ExtractionFile[] = [];
  for (const file of files) {
    const { data, error } = await bucket.download(file.path);
    if (error || !data) {
      return failure("storage", "Não foi possível ler o arquivo enviado. Tente de novo.", 500);
    }
    downloads.push({
      data: await data.arrayBuffer(),
      mimeType: resolveMime(file.name, file.type) ?? file.type,
      name: file.name,
    });
  }

  try {
    const extraction = await extractTemplateWithGemini(downloads);
    return reply({
      ok: true,
      draft: {
        title: normalizeTitle(extraction.suggestedTitle),
        schema: normalizeTemplate(extraction),
        sourceFilePath: folder,
        origin: "ai",
      },
    });
  } catch (error) {
    // Envio que não virou modelo não precisa ficar guardado.
    await removeUpload();
    if (error instanceof ExtractionError) {
      return failure(error.code, error.message, STATUS[error.code]);
    }
    console.error("Falha inesperada na extração", error);
    return failure("unexpected", "Algo deu errado ao ler a ficha. Tente de novo.", 500);
  }
}
