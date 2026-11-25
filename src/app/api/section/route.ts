/**
 * GET /api/section?passage=123
 * The whole 10-K section a cited passage comes from, for the citation side
 * panel. Public filing text, read with the publishable (read-only) key.
 */
import { createClient } from "@supabase/supabase-js";
import { loadSection, parsePassageId } from "@/lib/web/section";

export async function GET(request: Request): Promise<Response> {
  const passageId = parsePassageId(new URL(request.url).searchParams.get("passage"));
  if (passageId === undefined) return Response.json({ error: "passage must be a passage id." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "The server isn't configured yet." }, { status: 500 });

  try {
    const view = await loadSection(createClient(url, key, { auth: { persistSession: false } }), passageId);
    if (!view) return Response.json({ error: "No such passage. It may have been replaced when the filing was re-parsed." }, { status: 404 });
    // Filing text doesn't change between re-parses often; let the browser keep it for an hour.
    return Response.json(view, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    console.error("section:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Couldn't load this section." }, { status: 500 });
  }
}
