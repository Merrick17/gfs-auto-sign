import { z } from "zod";
import { getDb } from "./db";

// Owner preferences, stored as two small JSON values.

const signingSchema = z.object({
  autoSign: z.boolean().default(false),
  authorizedAt: z.string().nullable().default(null),
  authorizedBy: z.string().nullable().default(null),
});
export type SigningSettings = z.infer<typeof signingSchema>;

const draftSchema = z.object({
  message: z.string().max(4000).default(""),
  cc: z.array(z.string()).default([]),
});
export type DraftSettings = z.infer<typeof draftSchema>;

async function read<T>(key: string, schema: z.ZodType<T>): Promise<T> {
  const row = await getDb().appSetting.findUnique({ where: { key } });
  const r = schema.safeParse(row?.value ?? {});
  return r.success ? r.data : schema.parse({});
}

async function write(key: string, value: object) {
  await getDb().appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export const getSigningSettings = () => read("signing", signingSchema);
export const getDraftSettings = () => read("draft", draftSchema);

// Turning automatic signing on is the owner's explicit authorization, recorded with who and when.
export async function setAutoSign(on: boolean, actor: string) {
  const value: SigningSettings = on
    ? { autoSign: true, authorizedAt: new Date().toISOString(), authorizedBy: actor }
    : { autoSign: false, authorizedAt: null, authorizedBy: null };
  await write("signing", value);
  await getDb().auditEvent.create({ data: { actor, action: on ? "auto-sign:authorized" : "auto-sign:revoked" } });
}

export async function setDraftSettings(value: DraftSettings, actor: string) {
  await write("draft", draftSchema.parse(value));
  await getDb().auditEvent.create({ data: { actor, action: "draft-settings:changed" } });
}
