import { AuthRequest } from "../types/AuthRequest";
import { Request, Response } from "express";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
} from "../../types/feature";
import { getOrgFromReq } from "../services/organizations";
import {
  addFeatureRule,
  createFeature,
  deleteFeature,
  editFeatureEnvironment,
  editFeatureRule,
  getAllFeatures,
  getFeature,
  toggleFeatureEnvironment,
  updateFeature,
} from "../models/FeatureModel";
import { getRealtimeUsageByHour } from "../models/RealtimeModel";
import { lookupOrganizationByApiKey } from "../services/apiKey";
import {
  addIdsToRules,
  arrayMove,
  featureUpdated,
  getEnabledEnvironments,
  getFeatureDefinitions,
} from "../services/features";
import { getExperimentByTrackingKey } from "../services/experiments";
import { ExperimentDocument } from "../models/ExperimentModel";
import { FeatureUsageRecords } from "../../types/realtime";

export async function getFeaturesPublic(req: Request, res: Response) {
  const { key } = req.params;

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  try {
    const { organization, environment } = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res.status(400).json({
        status: 400,
        error: "Invalid API key",
      });
    }

    const features = await getFeatureDefinitions(
      organization,
      environment,
      project
    );

    // Cache for 30 seconds, serve stale up to 1 hour (10 hours if origin is down)
    res.set(
      "Cache-control",
      "public, max-age=30, stale-while-revalidate=3600, stale-if-error=36000"
    );

    res.status(200).json({
      status: 200,
      features,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({
      status: 400,
      error: "Failed to get features",
    });
  }
}

export async function postFeatures(
  req: AuthRequest<Partial<FeatureInterface>>,
  res: Response
) {
  const { id, ...otherProps } = req.body;
  const { org, environments } = getOrgFromReq(req);

  if (!id) {
    throw new Error("Must specify feature key");
  }

  if (!id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
    throw new Error(
      "Feature keys can only include letters, numbers, hyphens, and underscores."
    );
  }

  const environmentSettings: Record<string, FeatureEnvironment> = {};
  environments.forEach((env) => {
    environmentSettings[env.id] = {
      enabled: true,
      rules: [],
    };
  });

  const feature: FeatureInterface = {
    defaultValue: "",
    valueType: "boolean",
    description: "",
    project: "",
    environmentSettings,
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id: id.toLowerCase(),
  };

  addIdsToRules(feature.environmentSettings, feature.id);

  await createFeature(feature);

  featureUpdated(feature);
  res.status(200).json({
    status: 200,
    feature,
  });
}

export async function postFeatureRule(
  req: AuthRequest<{ rule: FeatureRule; environment: string }, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, rule } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  await addFeatureRule(feature, environment, rule);

  res.status(200).json({
    status: 200,
  });
}

export async function putFeatureRule(
  req: AuthRequest<
    { rule: Partial<FeatureRule>; environment: string; i: number },
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, rule, i } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  await editFeatureRule(feature, environment, i, rule);

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureToggle(
  req: AuthRequest<{ environment: string; state: boolean }, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, state } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  await toggleFeatureEnvironment(feature, environment, state);

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureMoveRule(
  req: AuthRequest<
    { environment: string; from: number; to: number },
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, from, to } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const rules = feature.environmentSettings?.[environment]?.rules ?? [];
  if (!rules[from] || !rules[to]) {
    throw new Error("Invalid rule index");
  }

  const newRules = arrayMove(rules, from, to);

  await editFeatureEnvironment(feature, environment, { rules: newRules });

  res.status(200).json({
    status: 200,
  });
}

export async function deleteFeatureRule(
  req: AuthRequest<{ environment: string; i: number }, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, i } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const rules = feature.environmentSettings?.[environment]?.rules ?? [];

  const newRules = rules.slice();
  newRules.splice(i, 1);

  await editFeatureEnvironment(feature, environment, { rules: newRules });

  res.status(200).json({
    status: 200,
  });
}

export async function putFeature(
  req: AuthRequest<Partial<FeatureInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const {
    id: newId,
    organization,
    dateUpdated,
    dateCreated,
    ...updates
  } = req.body;

  if (newId || organization || dateUpdated || dateCreated) {
    throw new Error("Invalid update fields for feature");
  }

  addIdsToRules(updates.environmentSettings, id);

  // See if anything important changed that requires firing a webhook
  let requiresWebhook = false;
  if (
    "defaultValue" in updates &&
    updates.defaultValue !== feature.defaultValue
  ) {
    requiresWebhook = true;
  }
  if ("environmentSettings" in updates) {
    // TODO: don't fire a webhook if only a rule description was changed
    if (
      JSON.stringify(updates.environmentSettings) !==
      JSON.stringify(feature.environmentSettings)
    ) {
      requiresWebhook = true;
    }
  }
  if ("project" in updates && updates.project !== feature.project) {
    requiresWebhook = true;
  }

  await updateFeature(feature.organization, id, {
    ...updates,
    dateUpdated: new Date(),
  });

  if (requiresWebhook) {
    featureUpdated(
      {
        ...feature,
        ...updates,
      },
      getEnabledEnvironments(feature),
      feature.project || ""
    );
  }

  res.status(200).json({
    feature: {
      ...feature,
      ...updates,
      dateUpdated: new Date(),
    },
    status: 200,
  });
}

export async function deleteFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  const feature = await getFeature(org.id, id);

  if (feature) {
    await deleteFeature(org.id, id);
    featureUpdated(feature);
  }

  res.status(200).json({
    status: 200,
  });
}

export async function getFeatures(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const features = await getAllFeatures(org.id, project);

  res.status(200).json({
    status: 200,
    features,
  });
}

export async function getFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const expIds: Set<string> = new Set();
  if (feature.environmentSettings) {
    Object.values(feature.environmentSettings).forEach((env) => {
      env.rules?.forEach((r) => {
        if (r.type === "experiment" && r.trackingKey) {
          expIds.add(r.trackingKey);
        }
      });
    });
  }

  const experiments: { [key: string]: ExperimentDocument } = {};
  if (expIds.size > 0) {
    await Promise.all(
      Array.from(expIds).map(async (id) => {
        const exp = await getExperimentByTrackingKey(org.id, id);
        if (exp) {
          experiments[id] = exp;
        }
      })
    );
  }

  res.status(200).json({
    status: 200,
    feature,
    experiments,
  });
}

export async function getRealtimeUsage(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const NUM_MINUTES = 30;

  // Get feature usage for the current hour
  const now = new Date();
  const current = await getRealtimeUsageByHour(
    org.id,
    now.toISOString().substring(0, 13)
  );

  const usage: FeatureUsageRecords = {};
  if (current) {
    Object.keys(current.features).forEach((feature) => {
      usage[feature] = { realtime: [] };
      for (let i = now.getMinutes(); i >= 0; i--) {
        usage[feature].realtime.push({
          used: current.features[feature]?.used?.[i] || 0,
          skipped: current.features[feature]?.skipped?.[i] || 0,
        });
      }
    });
  }

  // If needed, pull in part of the previous hour to get to 30 data points
  if (now.getMinutes() < NUM_MINUTES - 1) {
    const stop = 59 - (NUM_MINUTES - 1 - now.getMinutes());
    const lastHour = new Date(now);
    lastHour.setHours(lastHour.getHours() - 1);

    const lastHourData = await getRealtimeUsageByHour(
      org.id,
      lastHour.toISOString().substring(0, 13)
    );
    if (lastHourData) {
      Object.keys(lastHourData.features).forEach((feature) => {
        if (!usage[feature]) {
          usage[feature] = {
            realtime: Array(now.getMinutes() + 1).fill({
              used: 0,
              skipped: 0,
            }),
          };
        }
        for (let i = 59; i >= stop; i--) {
          usage[feature].realtime.push({
            used: lastHourData.features[feature]?.used?.[i] || 0,
            skipped: lastHourData.features[feature]?.skipped?.[i] || 0,
          });
        }
      });
    }
  }

  // Pad out all usage arrays to 30 items and reverse arrays
  Object.keys(usage).forEach((feature) => {
    while (usage[feature].realtime.length < 30) {
      usage[feature].realtime.push({
        used: 0,
        skipped: 0,
      });
    }
    // Remove any extra items and reverse
    usage[feature].realtime = usage[feature].realtime.slice(0, 30);
    usage[feature].realtime.reverse();
  });

  res.status(200).json({
    status: 200,
    usage,
  });
}
