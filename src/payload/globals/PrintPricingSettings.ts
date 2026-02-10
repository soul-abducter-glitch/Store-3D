import type { GlobalConfig } from "payload";

import { hasFunnelAdminAccess } from "@/lib/funnelEvents";
import { DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS } from "@/lib/printPricingSettings";

const canUpdateSettings = ({ req }: any) =>
  Boolean(req?.user && hasFunnelAdminAccess(req.user?.email));

const defaults = DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS;

export const PrintPricingSettings: GlobalConfig = {
  slug: "print-pricing-settings",
  label: "Print Pricing Settings",
  access: {
    read: () => true,
    update: canUpdateSettings,
  },
  admin: {
    group: "Settings",
  },
  fields: [
    {
      name: "smartEnabled",
      type: "checkbox",
      label: "Enable Smart Pricing",
      defaultValue: defaults.smartEnabled,
    },
    {
      name: "queueMultiplier",
      type: "number",
      label: "Queue Multiplier",
      min: 1,
      max: 2,
      defaultValue: defaults.queueMultiplier,
      admin: {
        step: 0.01,
      },
    },
    {
      name: "coefficients",
      type: "group",
      fields: [
        {
          name: "baseFee",
          type: "number",
          min: 0,
          defaultValue: defaults.coefficients.baseFee,
          admin: { step: 1 },
        },
        {
          name: "minPrice",
          type: "number",
          min: 0,
          defaultValue: defaults.coefficients.minPrice,
          admin: { step: 1 },
        },
        {
          name: "maxSmartPrice",
          type: "number",
          min: 1000,
          defaultValue: defaults.coefficients.maxSmartPrice,
          admin: { step: 100 },
        },
        {
          name: "materialRateStandardResin",
          type: "number",
          min: 0.1,
          defaultValue: defaults.coefficients.materialRateStandardResin,
          admin: { step: 0.1 },
        },
        {
          name: "materialRateToughResin",
          type: "number",
          min: 0.1,
          defaultValue: defaults.coefficients.materialRateToughResin,
          admin: { step: 0.1 },
        },
        {
          name: "materialRateStandardPLA",
          type: "number",
          min: 0.1,
          defaultValue: defaults.coefficients.materialRateStandardPLA,
          admin: { step: 0.1 },
        },
        {
          name: "materialRateABSPro",
          type: "number",
          min: 0.1,
          defaultValue: defaults.coefficients.materialRateABSPro,
          admin: { step: 0.1 },
        },
        {
          name: "machineRateSla",
          type: "number",
          min: 1,
          defaultValue: defaults.coefficients.machineRateSla,
          admin: { step: 1 },
        },
        {
          name: "machineRateFdm",
          type: "number",
          min: 1,
          defaultValue: defaults.coefficients.machineRateFdm,
          admin: { step: 1 },
        },
        {
          name: "qualityMultiplierPro",
          type: "number",
          min: 1,
          max: 3,
          defaultValue: defaults.coefficients.qualityMultiplierPro,
          admin: { step: 0.01 },
        },
        {
          name: "slaHollowFactor",
          type: "number",
          min: 0.08,
          max: 1,
          defaultValue: defaults.coefficients.slaHollowFactor,
          admin: { step: 0.01 },
        },
      ],
    },
  ],
};
