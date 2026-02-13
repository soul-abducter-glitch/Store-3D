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
  const adminEmails = parseAdminEmails();
  return adminEmails.includes(userEmail);
};

const canReadOwnJobs: Access = ({ req }) => {
  if (!req?.user) return false;
  if (isAdminUser(req)) return true;
  return {
    user: {
      equals: req.user.id,
    },
  };
};

const canCreateJob: Access = ({ req }) => Boolean(req?.user);

export const AiJobs: CollectionConfig = {
  slug: "ai_jobs",
  admin: {
    useAsTitle: "prompt",
    group: "AI",
    defaultColumns: ["status", "mode", "provider", "progress", "updatedAt"],
  },
  access: {
    read: canReadOwnJobs,
    create: canCreateJob,
    update: canReadOwnJobs,
    delete: canReadOwnJobs,
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
      name: "status",
      type: "select",
      required: true,
      defaultValue: "queued",
      options: [
        { label: "Queued", value: "queued" },
        { label: "Processing", value: "processing" },
        { label: "Completed", value: "completed" },
        { label: "Failed", value: "failed" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "mode",
      type: "select",
      required: true,
      defaultValue: "image",
      options: [
        { label: "Image to 3D", value: "image" },
        { label: "Text to 3D", value: "text" },
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
      name: "providerJobId",
      type: "text",
      admin: {
        position: "sidebar",
        readOnly: true,
      },
    },
    {
      name: "progress",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 0,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "prompt",
      type: "textarea",
      required: true,
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
      name: "errorMessage",
      type: "textarea",
    },
    {
      name: "result",
      type: "group",
      fields: [
        {
          name: "modelUrl",
          type: "text",
        },
        {
          name: "previewUrl",
          type: "text",
        },
        {
          name: "format",
          type: "select",
          options: [
            { label: "GLB", value: "glb" },
            { label: "GLTF", value: "gltf" },
            { label: "OBJ", value: "obj" },
            { label: "STL", value: "stl" },
            { label: "Unknown", value: "unknown" },
          ],
          defaultValue: "unknown",
        },
      ],
    },
    {
      name: "startedAt",
      type: "date",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "completedAt",
      type: "date",
      admin: {
        position: "sidebar",
      },
    },
  ],
};
