import { redirect } from "next/navigation";
import { getSession, loadActiveUser } from "@/lib/auth";

export default async function Home() {
  const active = await loadActiveUser(await getSession());
  redirect(active ? "/dashboard" : "/login");
}
