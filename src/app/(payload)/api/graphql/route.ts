import payloadConfig from "../../../../payload.config";
import {
  GRAPHQL_PLAYGROUND_GET,
  GRAPHQL_POST,
} from "@payloadcms/next/exports/routes";

export const dynamic = "force-dynamic";

export const GET = GRAPHQL_PLAYGROUND_GET(payloadConfig);
export const POST = GRAPHQL_POST(payloadConfig);
