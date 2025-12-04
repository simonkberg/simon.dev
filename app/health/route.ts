import { connection } from "next/server";

export async function GET() {
  await connection();
  return new Response("OK", { status: 200 });
}
