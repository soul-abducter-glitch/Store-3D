import type { CollectionConfig } from "payload";

import { isAuthenticated } from "../access.ts";

export const Media: CollectionConfig = {
  slug: "media",
  admin: {
    useAsTitle: "filename",
  },
  access: {
    read: () => true,
    create: () => true,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  upload: {
    staticDir: "media",
    adminThumbnail: () => null,
    imageSizes: [],
    disableLocalStorage: true, // Используем S3 (Tebi.io)
    filesRequiredOnCreate: false, // Allow creating records after direct-to-S3 upload
    mimeTypes: [
      "image/*",
      "model/*",
      "model/gltf-binary",
      "model/gltf+json",
      "application/gltf+json",
      ".glb",
      ".gltf",
      ".obj",
      "model/stl",
      "model/obj",
      "text/plain",
      "application/octet-stream",
      "application/sla",
      "application/vnd.ms-pki.stl",
    ],
  },
  fields: [
    {
      name: "alt",
      type: "text",
      label: "Alt Text",
      admin: {
        description: "Alternative text for accessibility",
      },
    },
    {
      name: "fileType",
      type: "select",
      label: "File Type",
      admin: {
        position: "sidebar",
        description: "Type of media file",
      },
      options: [
        { label: "Image", value: "image" },
        { label: "3D Model (.glb/.gltf)", value: "3d-model" },
        { label: "Other", value: "other" },
      ],
    },
    {
      name: "isCustomerUpload",
      type: "checkbox",
      label: "Customer Upload",
      defaultValue: false,
      admin: {
        position: "sidebar",
      },
    },
  ],
};

