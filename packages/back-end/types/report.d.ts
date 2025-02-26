import { SnapshotVariation } from "./experiment-snapshot";
import { Queries } from "./query";

export interface ReportInterfaceBase {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  organization: string;
  experimentId?: string;
  userId?: string;
  title: string;
  description: string;
  runStarted: Date | null;
  error?: string;
  queries: Queries;
  status?: "published" | "private";
}

export interface ExperimentReportVariation {
  id: string;
  name: string;
  weight: number;
}
export interface ExperimentReportArgs {
  trackingKey: string;
  datasource: string;
  userIdType?: "anonymous" | "user";
  startDate: Date;
  endDate?: Date;
  dimension?: string;
  variations: ExperimentReportVariation[];
  segment?: string;
  metrics: string[];
  guardrails?: string[];
  activationMetric?: string;
  queryFilter?: string;
  skipPartialData?: boolean;
  removeMultipleExposures?: boolean;
}
export interface ExperimentReportResultDimension {
  name: string;
  srm: number;
  variations: SnapshotVariation[];
}
export interface ExperimentReportResults {
  unknownVariations: string[];
  multipleExposures: number;
  dimensions: ExperimentReportResultDimension[];
}
export interface ExperimentReportInterface extends ReportInterfaceBase {
  type: "experiment";
  args: ExperimentReportArgs;
  results?: ExperimentReportResults;
}

export type ReportInterface = ExperimentReportInterface;
