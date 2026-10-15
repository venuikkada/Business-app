import type { NextRequest } from "next/server";
import { dispatch } from "@/lib/router";
import { router } from "@/lib/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ path: string[] }> };
const handle = async (req: NextRequest, { params }: P) => dispatch(router, req, (await params).path);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
