import type { CollectionConfig } from "payload";

export const Media: CollectionConfig = {
  slug: "media",
  admin: {
    useAsTitle: "filename",
  },
  upload: {
    staticDir: "media",
    mimeTypes: [
      "image/*",
      "model/*",
      "model/gltf-binary",
      "model/gltf+json",
      "model/stl",
      "application/octet-stream",
      "application/sla",
      "application/vnd.ms-pki.stl",
    ],
  },
  fields: [
    {
      name: "alt",
      type: "text",
    },
  ],
};
