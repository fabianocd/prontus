"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  FileImage,
  FileText,
  FileUp,
  LoaderCircle,
  PencilLine,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { saveTemplateDraft } from "@/lib/templates/draft-storage";
import {
  EXTRACT_ENDPOINT,
  REVIEW_PATH,
  type ExtractRequest,
  type ExtractResponse,
} from "@/lib/templates/extract-api";
import type { QuotaNotice } from "@/lib/templates/extraction-limit";
import { createBlankTemplate } from "@/lib/templates/normalize";
import {
  ACCEPT_ATTRIBUTE,
  DOCS_BUCKET,
  MAX_IMAGES,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  checkUpload,
  extensionForMime,
  formatBytes,
  resolveMime,
  sourceFolder,
} from "@/lib/uploads";
import { cn } from "@/lib/utils";

type Phase =
  | { step: "idle" }
  | { step: "uploading"; done: number; total: number }
  | { step: "extracting" }
  | { step: "error"; message: string; canRetry: boolean };

type PickedFile = { key: string; file: File };

const GENERIC_ERROR = "Algo deu errado ao ler a ficha. Tente de novo.";

export function UploadForm({
  userId,
  quotaNotice,
}: {
  userId: string;
  quotaNotice: QuotaNotice;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  // Limite de leituras atingido (já na abertura da página ou pela resposta da rota).
  const [limitMessage, setLimitMessage] = useState(
    quotaNotice?.kind === "blocked" ? quotaNotice.message : null,
  );

  const busy = phase.step === "uploading" || phase.step === "extracting";
  const check = files.length > 0 ? checkUpload(files.map(({ file }) => file)) : null;
  const totalBytes = files.reduce((sum, { file }) => sum + file.size, 0);
  const isPdf = files.length === 1 && resolveMime(files[0].file.name, files[0].file.type) === PDF_MIME;

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).map((file) => ({ key: crypto.randomUUID(), file }));
    setFiles((current) => {
      const hasPdf = (picked: PickedFile[]) =>
        picked.some(({ file }) => resolveMime(file.name, file.type) === PDF_MIME);
      // PDF substitui a seleção; imagens se somam às imagens já escolhidas.
      if (hasPdf(incoming) || hasPdf(current)) return incoming;
      return [...current, ...incoming];
    });
    setPhase({ step: "idle" });
  }

  function removeFile(key: string) {
    setFiles((current) => current.filter((item) => item.key !== key));
    setPhase({ step: "idle" });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) addFiles(event.dataTransfer.files);
  }

  function createManually() {
    saveTemplateDraft({ title: "", schema: createBlankTemplate(), origin: "manual" });
    router.push(REVIEW_PATH);
  }

  async function extract() {
    if (!check?.ok || limitMessage) return;
    const uploadId = crypto.randomUUID();
    const folder = sourceFolder(userId, uploadId);
    const supabase = createClient();

    setPhase({ step: "uploading", done: 0, total: files.length });
    try {
      for (const [index, { file }] of files.entries()) {
        const mime = check.mimes[index];
        const path = `${folder}/${String(index + 1).padStart(2, "0")}.${extensionForMime(mime)}`;
        const { error } = await supabase.storage
          .from(DOCS_BUCKET)
          .upload(path, file, { contentType: mime, upsert: false });
        if (error) throw error;
        setPhase({ step: "uploading", done: index + 1, total: files.length });
      }
    } catch {
      setPhase({
        step: "error",
        message: "Não foi possível enviar o arquivo. Confira sua conexão e tente de novo.",
        canRetry: true,
      });
      return;
    }

    setPhase({ step: "extracting" });
    let result: ExtractResponse;
    try {
      const response = await fetch(EXTRACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId } satisfies ExtractRequest),
      });
      const isJson = response.headers.get("content-type")?.includes("application/json");
      // Sem sessão o proxy redireciona para /entrar (HTML).
      result = isJson
        ? ((await response.json()) as ExtractResponse)
        : {
            ok: false,
            code: response.redirected ? "unauthorized" : "unexpected",
            message: response.redirected
              ? "Sua sessão expirou. Entre de novo para continuar."
              : GENERIC_ERROR,
          };
    } catch {
      result = { ok: false, code: "network", message: "Sem conexão com o servidor. Tente de novo." };
    }

    if (!result.ok && result.code === "rate_limited") {
      setLimitMessage(result.message);
      setPhase({ step: "idle" });
      return;
    }

    if (!result.ok) {
      setPhase({
        step: "error",
        message: result.message || GENERIC_ERROR,
        canRetry: !["invalid_upload", "not_anamnesis", "unauthorized"].includes(result.code),
      });
      return;
    }

    if (!saveTemplateDraft(result.draft)) {
      setPhase({
        step: "error",
        message: "O navegador bloqueou o armazenamento temporário. Libere o armazenamento do site e tente de novo.",
        canRetry: true,
      });
      return;
    }
    router.push(REVIEW_PATH);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="glass rounded-3xl p-4 sm:p-6" aria-labelledby={`${inputId}-title`}>
        <h2 id={`${inputId}-title`} className="sr-only">
          Arquivo da ficha
        </h2>

        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-border px-4 py-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 has-focus-visible:border-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:py-14",
            dragging && "border-primary bg-primary/10",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <span className="mb-4 grid size-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
            <FileUp className="size-6" aria-hidden />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">
            {files.length > 0 && !isPdf ? "Adicionar mais fotos" : "Escolha o PDF ou as fotos da ficha"}
          </span>
          <span className="mt-1 hidden text-sm text-muted-foreground sm:block">
            Arraste os arquivos para cá ou clique para escolher.
          </span>
          <span className="mt-2 max-w-md text-xs text-muted-foreground">
            1 PDF ou até {MAX_IMAGES} fotos (JPG, PNG, WebP ou HEIC), até{" "}
            {formatBytes(MAX_UPLOAD_BYTES)} no total. Fotos são lidas na ordem da lista.
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              // Permite escolher o mesmo arquivo de novo depois de removê-lo.
              event.target.value = "";
            }}
          />
        </label>

        {files.length > 0 ? (
          <div className="mt-4">
            <ol className="flex flex-col gap-2" aria-label="Arquivos escolhidos">
              {files.map(({ key, file }, index) => {
                const Icon = resolveMime(file.name, file.type) === PDF_MIME ? FileText : FileImage;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background/40 py-2 pr-2 pl-3"
                  >
                    <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {files.length > 1 ? `${index + 1}. ` : ""}
                        {file.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-full"
                      disabled={busy}
                      onClick={() => removeFile(key)}
                      aria-label={`Remover ${file.name}`}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ol>
            {files.length > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {files.length} arquivos · {formatBytes(totalBytes)}
              </p>
            ) : null}
          </div>
        ) : null}

        {check && !check.ok ? (
          <FormAlert tone="error" className="mt-4">
            {check.message}
          </FormAlert>
        ) : null}

        <div aria-live="polite">
          {limitMessage ? (
            <FormAlert tone="error" className="mt-4">
              {limitMessage}
            </FormAlert>
          ) : quotaNotice?.kind === "low" ? (
            <p className="mt-4 text-xs text-muted-foreground">{quotaNotice.message}</p>
          ) : null}

          {phase.step === "uploading" || phase.step === "extracting" ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-sm">
              <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
              <div>
                {phase.step === "uploading" ? (
                  <p>
                    Enviando {phase.total > 1 ? `arquivo ${Math.min(phase.done + 1, phase.total)} de ${phase.total}` : "arquivo"}
                    …
                  </p>
                ) : (
                  <>
                    <p className="font-medium">Lendo a ficha com IA…</p>
                    <p className="text-muted-foreground">
                      Pode levar 1 a 2 minutos em fichas longas. Não feche esta página.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {phase.step === "error" ? (
            <FormAlert tone="error" className="mt-4">
              <p>{phase.message}</p>
              <p className="mt-1 text-muted-foreground">
                Se preferir, crie o modelo manualmente.
              </p>
            </FormAlert>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-10 rounded-xl px-4"
            disabled={busy}
            onClick={createManually}
          >
            <PencilLine aria-hidden />
            Criar manualmente
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-10 rounded-xl px-4"
            disabled={busy || !check?.ok || Boolean(limitMessage)}
            aria-busy={busy || undefined}
            onClick={extract}
          >
            {busy ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : phase.step === "error" && phase.canRetry ? (
              <RotateCcw aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            {busy ? "Lendo…" : phase.step === "error" && phase.canRetry ? "Tentar de novo" : "Ler ficha com IA"}
          </Button>
        </div>
      </section>

      <p className="px-1 text-xs text-muted-foreground">
        O arquivo fica guardado na sua conta e é enviado ao Gemini (Google) só para leitura da
        estrutura. Envie apenas a ficha em branco, sem dados de pacientes.
      </p>
    </div>
  );
}
