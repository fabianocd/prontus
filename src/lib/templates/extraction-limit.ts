import { z } from "zod";

/**
 * Limite de leituras da ficha com IA por conta (decisão 38 do PLANO).
 * Os números valem no banco (`get_extraction_quota`/`claim_extraction`,
 * migration `extraction_rate_limit`); aqui servem só para textos.
 */
export const EXTRACTIONS_PER_HOUR = 10;
export const EXTRACTIONS_PER_DAY = 30;

/** Abaixo disso a página mostra quantas leituras restam. */
const LOW_REMAINING = 3;

export const extractionQuotaSchema = z.object({
  hour_limit: z.number(),
  day_limit: z.number(),
  hour_used: z.number(),
  day_used: z.number(),
  blocked_by: z.enum(["hour", "day"]).nullable(),
  retry_after_seconds: z.number(),
  allowed: z.boolean().optional(),
});

export type ExtractionQuota = z.infer<typeof extractionQuotaSchema>;

/** O que a página "Novo modelo" precisa saber (serializável para o client). */
export type QuotaNotice =
  | { kind: "blocked"; message: string }
  | { kind: "low"; message: string }
  | null;

/** "45 min", "1 h", "3 h 20 min" (arredondado para cima, mínimo 1 min). */
export function formatWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function blockedMessage(quota: ExtractionQuota): string {
  const limit =
    quota.blocked_by === "day"
      ? `${quota.day_limit} leituras com IA por dia`
      : `${quota.hour_limit} leituras com IA por hora`;
  return `Você atingiu o limite de ${limit}. Tente de novo em ${formatWait(quota.retry_after_seconds)} ou crie o modelo manualmente.`;
}

export function quotaNotice(quota: ExtractionQuota): QuotaNotice {
  if (quota.blocked_by) return { kind: "blocked", message: blockedMessage(quota) };
  const hourLeft = quota.hour_limit - quota.hour_used;
  const dayLeft = quota.day_limit - quota.day_used;
  const left = Math.min(hourLeft, dayLeft);
  if (left > LOW_REMAINING) return null;
  const scope = dayLeft <= hourLeft ? "hoje" : "nesta hora";
  return {
    kind: "low",
    message: `${left === 1 ? "Resta 1 leitura" : `Restam ${left} leituras`} com IA ${scope}.`,
  };
}
