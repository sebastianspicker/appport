import { getAuth } from "@/server/auth/better-auth";

export function GET(request: Request) {
  return getAuth().handler(request);
}

export function POST(request: Request) {
  return getAuth().handler(request);
}
