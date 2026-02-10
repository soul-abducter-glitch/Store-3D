import { RootLayout as PayloadRootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import type { ServerFunctionClientArgs } from "payload";

const loadPayloadContext = async () => {
  const [{ getPayload }, payloadConfigModule, importMapModule] = await Promise.all([
    import("payload"),
    import("../../../payload.config"),
    import("./admin/importMap"),
  ]);

  return {
    getPayload,
    payloadConfig: payloadConfigModule.default,
    importMap: importMapModule.importMap,
  };
};

async function serverFunction(args: ServerFunctionClientArgs) {
  "use server";
  const { getPayload, payloadConfig, importMap } = await loadPayloadContext();
  const payload = await getPayload({ config: payloadConfig, importMap });
  return handleServerFunctions({
    ...args,
    config: Promise.resolve(payload.config),
    importMap,
  });
}

export const dynamic = "force-dynamic";

export default async function PayloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getPayload, payloadConfig, importMap } = await loadPayloadContext();
  const payload = await getPayload({ config: payloadConfig, importMap });

  return PayloadRootLayout({
    children,
    config: Promise.resolve(payload.config),
    importMap,
    serverFunction,
  });
}
