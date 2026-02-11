export type StlPreflightStatus = "ok" | "risk" | "critical";
export type StlPreflightSeverity = "risk" | "critical";

export type StlPreflightIssue = {
  code:
    | "missing_dimensions"
    | "invalid_dimensions"
    | "missing_volume"
    | "invalid_volume"
    | "out_of_bed"
    | "estimated_volume"
    | "very_low_density"
    | "low_density"
    | "thin_feature_critical"
    | "thin_feature_risk"
    | "high_aspect_ratio"
    | "large_volume_risk"
    | "large_volume_critical";
  severity: StlPreflightSeverity;
  message: string;
};

export type StlPreflightInput = {
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
  volumeMethod?: "mesh" | "fallback";
  bedSizeMm?: { x: number; y: number; z: number };
};

export type StlPreflightReport = {
  status: StlPreflightStatus;
  score: number;
  issues: StlPreflightIssue[];
  summary: string;
};

const DEFAULT_BED_MM = { x: 200, y: 200, z: 200 };
const MIN_FEATURE_RISK_MM = 1.8;
const MIN_FEATURE_CRITICAL_MM = 1.2;
const DENSITY_RISK = 0.08;
const DENSITY_CRITICAL = 0.03;
const VOLUME_RISK_CM3 = 350;
const VOLUME_CRITICAL_CM3 = 900;
const ASPECT_RATIO_RISK = 20;

const asPositive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const round = (value: number, digits = 1) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const buildSummary = (status: StlPreflightStatus, issueCount: number) => {
  if (status === "critical") return "Есть критичные риски печати. Исправьте модель перед заказом.";
  if (status === "risk") {
    return issueCount > 1
      ? "Обнаружены риски печати. Рекомендуется проверка оператором."
      : "Есть риск печати. Проверьте параметры модели.";
  }
  return "Авто-проверка не выявила критичных проблем.";
};

export const evaluateStlPreflight = (input: StlPreflightInput): StlPreflightReport => {
  const issues: StlPreflightIssue[] = [];
  const bed = input.bedSizeMm ?? DEFAULT_BED_MM;

  const dimsRaw = input.dimensions;
  const x = asPositive(dimsRaw?.x);
  const y = asPositive(dimsRaw?.y);
  const z = asPositive(dimsRaw?.z);

  if (!dimsRaw) {
    issues.push({
      code: "missing_dimensions",
      severity: "critical",
      message: "Не удалось определить габариты модели (X/Y/Z).",
    });
  } else if (!x || !y || !z) {
    issues.push({
      code: "invalid_dimensions",
      severity: "critical",
      message: "Габариты модели некорректны или равны нулю.",
    });
  }

  const volumeCm3 = asPositive(input.volumeCm3);
  if (input.volumeCm3 === undefined || input.volumeCm3 === null) {
    issues.push({
      code: "missing_volume",
      severity: "critical",
      message: "Не удалось определить объем модели.",
    });
  } else if (!volumeCm3) {
    issues.push({
      code: "invalid_volume",
      severity: "critical",
      message: "Объем модели некорректен или равен нулю.",
    });
  }

  if (x && y && z) {
    if (x > bed.x || y > bed.y || z > bed.z) {
      issues.push({
        code: "out_of_bed",
        severity: "critical",
        message: `Габариты превышают рабочую область принтера ${bed.x}×${bed.y}×${bed.z} мм.`,
      });
    }

    const minDim = Math.min(x, y, z);
    const maxDim = Math.max(x, y, z);
    const aspectRatio = maxDim / Math.max(minDim, 0.01);

    if (minDim < MIN_FEATURE_CRITICAL_MM) {
      issues.push({
        code: "thin_feature_critical",
        severity: "critical",
        message: `Есть очень тонкие элементы (${round(minDim)} мм). Возможна поломка/брак.`,
      });
    } else if (minDim < MIN_FEATURE_RISK_MM) {
      issues.push({
        code: "thin_feature_risk",
        severity: "risk",
        message: `Тонкие элементы (${round(minDim)} мм) требуют осторожной печати.`,
      });
    }

    if (aspectRatio > ASPECT_RATIO_RISK) {
      issues.push({
        code: "high_aspect_ratio",
        severity: "risk",
        message: "Модель сильно вытянута по одной оси. Возможно потребуется специальная ориентация.",
      });
    }

    if (volumeCm3) {
      const boundsVolumeCm3 = (x * y * z) / 1000;
      if (boundsVolumeCm3 > 0) {
        const density = volumeCm3 / boundsVolumeCm3;
        if (density < DENSITY_CRITICAL) {
          issues.push({
            code: "very_low_density",
            severity: "critical",
            message:
              "Объем слишком мал относительно габаритов. Вероятны дырки/невалидная геометрия.",
          });
        } else if (density < DENSITY_RISK) {
          issues.push({
            code: "low_density",
            severity: "risk",
            message: "Низкая плотность модели. Возможен открытый меш или тонкие стенки.",
          });
        }
      }
    }
  }

  if (input.volumeMethod === "fallback") {
    issues.push({
      code: "estimated_volume",
      severity: "risk",
      message: "Объем рассчитан приближенно. Геометрия может быть не полностью замкнутой.",
    });
  }

  if (volumeCm3 && volumeCm3 > VOLUME_CRITICAL_CM3) {
    issues.push({
      code: "large_volume_critical",
      severity: "critical",
      message: `Очень большой объем (${round(volumeCm3)} см3). Высокий риск долгой/нестабильной печати.`,
    });
  } else if (volumeCm3 && volumeCm3 > VOLUME_RISK_CM3) {
    issues.push({
      code: "large_volume_risk",
      severity: "risk",
      message: `Большой объем (${round(volumeCm3)} см3). Печать будет длительной и дорогой.`,
    });
  }

  const hasCritical = issues.some((item) => item.severity === "critical");
  const hasRisk = issues.some((item) => item.severity === "risk");
  const status: StlPreflightStatus = hasCritical ? "critical" : hasRisk ? "risk" : "ok";

  const scorePenalty = issues.reduce((sum, issue) => {
    return sum + (issue.severity === "critical" ? 35 : 15);
  }, 0);
  const score = Math.max(0, 100 - scorePenalty);

  return {
    status,
    score,
    issues,
    summary: buildSummary(status, issues.length),
  };
};

