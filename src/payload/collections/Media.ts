import type { Access, CollectionConfig } from "payload";

import { isAuthenticated } from "../access.ts";

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const allowPublicMediaRead: Access = ({ req }) => {
  const user = req?.user;
  if (!user) {
    const publicWhere: any = {
      isCustomerUpload: {
        not_equals: true,
      },
    };
    return publicWhere;
  }

  const userEmail = normalizeEmail((user as any)?.email);
  if (userEmail && parseAdminEmails().includes(userEmail)) {
    return true;
  }

  const userId = normalizeRelationshipId((user as any)?.id);
  const conditions: Array<Record<string, unknown>> = [
    {
      isCustomerUpload: {
        not_equals: true,
      },
    },
  ];
  if (userId !== null) {
    conditions.push({ ownerUser: { equals: userId as any } });
  }
  if (userEmail) {
    conditions.push({ ownerEmail: { equals: userEmail } });
  }

  const ownedWhere: any = {
    or: conditions,
  };
  return ownedWhere;
};

export const Media: CollectionConfig = {
  slug: "media",
  admin: {
    useAsTitle: "filename",
  },
  access: {
    read: allowPublicMediaRead,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  upload: {
    staticDir: "media",
    adminThumbnail: () => null,
    imageSizes: [],
    disableLocalStorage: true,
    filesRequiredOnCreate: false,
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
    {
      name: "ownerUser",
      type: "relationship",
      relationTo: "users",
      admin: {
        position: "sidebar",
        hidden: true,
      },
    },
    {
      name: "ownerEmail",
      type: "text",
      admin: {
        position: "sidebar",
        hidden: true,
      },
    },
    {
      name: "ownerSessionHash",
      type: "text",
      access: {
        read: () => false,
      },
      admin: {
        position: "sidebar",
        hidden: true,
      },
    },
  ],
};
