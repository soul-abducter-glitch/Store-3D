import type { CollectionConfig } from "payload";

export const Media: CollectionConfig = {
  slug: "media",
  admin: {
    useAsTitle: "filename",
  },
  upload: {
    staticDir: "media",
    adminThumbnail: () => null,
    imageSizes: [],
    disableLocalStorage: true, // Используем S3 (Tebi.io)
    mimeTypes: [
      "image/*",
      "model/*",
      "model/gltf-binary",
      "model/gltf+json",
      "application/gltf+json",
      ".glb",
      ".gltf",
      "model/stl",
      "application/octet-stream",
      "application/sla",
      "application/vnd.ms-pki.stl",
    ],
    maxSize: 100 * 1024 * 1024,
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
        { label: "STL File", value: "stl" },
        { label: "Other", value: "other" },
      ],
    },
  ],
};
