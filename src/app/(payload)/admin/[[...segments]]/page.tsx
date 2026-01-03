/* THIS IS AN ADMIN ROUTE */
import type { Metadata } from "next";
import payloadConfig from "../../../../../payload.config";
import { RootPage, generatePageMetadata } from "@payloadcms/next/views";
import { importMap } from "../importMap";

export const dynamic = "force-dynamic";

type Args = {
  params: Promise<{
    segments: string[];
  }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config: payloadConfig, params, searchParams });

const Page = ({ params, searchParams }: Args) =>
  RootPage({ config: payloadConfig, params, searchParams, importMap });

export default Page;
