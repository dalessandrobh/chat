/**
 * GET  /api/templates  — lista os templates locais
 * POST /api/templates  — cria e já submete para aprovação da Meta
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { currentAgent, unauthorized } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createTemplate, MetaApiError } from "@/lib/meta/client";
import { canManageTemplates } from "@/lib/roles";

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { data, error } = await supabaseAdmin()
    .from("templates")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

// -----------------------------------------------------------------------------

const componentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HEADER"),
    format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).default("TEXT"),
    text: z.string().max(60).optional(),
    example: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("BODY"),
    text: z.string().min(1).max(1024),
    example: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("FOOTER"),
    text: z.string().max(60),
  }),
  z.object({
    type: z.literal("BUTTONS"),
    buttons: z
      .array(
        z.object({
          type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
          text: z.string().max(25),
          url: z.string().optional(),
          phone_number: z.string().optional(),
        })
      )
      .max(10),
  }),
]);

const createSchema = z.object({
  channelId: z.string().uuid(),
  // A Meta só aceita snake_case minúsculo.
  name: z
    .string()
    .regex(/^[a-z0-9_]+$/, "Use apenas minúsculas, números e underscore")
    .max(512),
  language: z.string().default("pt_BR"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  components: z.array(componentSchema).min(1),
  /**
   * Exemplos das variáveis do BODY, na ordem: ["João", "#1234"].
   * A Meta REJEITA template com {{n}} sem exemplo — por isso exigimos aqui
   * em vez de descobrir na reprovação, dias depois.
   */
  bodyExamples: z.array(z.string()).default([]),
});

function countVariables(text: string): number {
  const found = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : 0;
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) {
    return NextResponse.json({ error: "Apenas admin cria template" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const components = structuredClone(input.components) as Array<Record<string, any>>;

  // --- Validação das variáveis do corpo ---
  const body = components.find((c) => c.type === "BODY");
  const variableCount = body ? countVariables(body.text) : 0;

  if (variableCount > 0) {
    if (input.bodyExamples.length !== variableCount) {
      return NextResponse.json(
        {
          error:
            `O corpo usa ${variableCount} variável(is), mas foram enviados ` +
            `${input.bodyExamples.length} exemplo(s). A Meta rejeita template ` +
            `com variável sem exemplo.`,
        },
        { status: 400 }
      );
    }
    // Formato exigido pela Graph API: array de arrays.
    body!.example = { body_text: [input.bodyExamples] };
  }

  // --- Submete para a Meta ---
  let metaResult;
  try {
    metaResult = await createTemplate({
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, code: err.details?.code, details: err.details?.error_data },
        { status: 400 }
      );
    }
    throw err;
  }

  // --- Espelha localmente ---
  const { data, error } = await supabaseAdmin()
    .from("templates")
    .upsert(
      {
        channel_id: input.channelId,
        name: input.name,
        language: input.language,
        category: input.category,
        components,
        meta_template_id: metaResult.id,
        status: (metaResult.status ?? "PENDING").toUpperCase(),
        created_by: agent.id,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "channel_id,name,language" }
    )
    .select()
    .single();

  if (error) {
    // O template já existe na Meta; só o espelho local falhou. Avisar em vez
    // de fingir sucesso, senão o painel fica dessincronizado em silêncio.
    return NextResponse.json(
      {
        error: `Template criado na Meta (id ${metaResult.id}), mas falhou ao salvar localmente: ${error.message}. Rode /api/templates/sync.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ template: data }, { status: 201 });
}
