import { destroySession, getSession } from "@/lib/auth";
import { handle, ok } from "@/lib/api";
import { clientMeta, writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await getSession();
    if (actor) {
      await writeAudit({
        actor,
        action: "LOGOUT",
        entityName: "users",
        entityId: actor.id,
        ...clientMeta(req),
      });
    }
    await destroySession();
    return ok({ success: true });
  });
}
