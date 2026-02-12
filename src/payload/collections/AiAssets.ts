import type { Access, CollectionConfig } from "payload";

const normalizeEmail = (value?: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdminUser = (req?: any) => {
  const userEmail = normalizeEmail(req?.user?.email);
  if (!userEmail) return false;
  return parseAdminEmails().includes(userEmail);
};

const canReadOwnAssets: Access = ({ req }) => {
  if (!req?.user) return false;
  if (isAdminUser(req)) return true;
  return {
    user: {
      equals: req.user.id,
    },
  };
};

const canCreateAsset: Access = ({ req }) => Boolean(req?.user);

export const AiAssets: CollectionConfig = {
  slug: "ai_assets",
  admin: {
    useAsTitle: "title",
    group: "AI",
    defaultColumns: ["title", "status", "format", "provider", "updatedAt"],
  },
  access: {
    read: canReadOwnAssets,
    create: canCreateAsset,
    update: canReadOwnAssets,
    delete: canReadOwnAssets,
  },
  fields: [
    {
      name: "user",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "job",
      type: "relationship",
      relationTo: "ai_jobs",
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "ready",
      options: [
        { label: "Ready", value: "ready" },
        { label: "Archived", value: "archived" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "provider",
      type: "text",
      defaultValue: "mock",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "title",
      type: "text",
      required: true,
    },
    {
      name: "prompt",
      type: "textarea",
    },
    {
      name: "sourceType",
      type: "select",
      defaultValue: "none",
      options: [
        { label: "None", value: "none" },
        { label: "URL", value: "url" },
        { label: "Image", value: "image" },
      ],
    },
    {
      name: "sourceUrl",
      type: "text",
    },
    {
      name: "previewUrl",
      type: "text",
    },
    {
      name: "modelUrl",
      type: "text",
      required: true,
    },
    {
      name: "format",
      type: "select",
      required: true,
      defaultValue: "unknown",
      options: [
        { label: "GLB", value: "glb" },
        { label: "GLTF", value: "gltf" },
        { label: "OBJ", value: "obj" },
        { label: "STL", value: "stl" },
        { label: "Unknown", value: "unknown" },
      ],
    },
  ],
};
