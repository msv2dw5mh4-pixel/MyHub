import { getAll, putOne, deleteOne } from "./db.js";
import { canonicalSportId, sportLabel } from "./sport_catalog.js";

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function normalizedDistance(session = {}) {
  const unit = String(session.distanceUnit || "").toLowerCase();
  const raw = Number(session.distance || 0);
  let km = Number(session.distanceKm || 0);
  let meters = Number(session.distanceMeters || 0);

  if (raw > 0 && unit === "m") {
    meters = raw;
    km = raw / 1000;
  } else if (raw > 0 && unit === "km") {
    km = raw;
    meters = raw * 1000;
  } else if (meters > 0) {
    km = meters / 1000;
  } else if (km > 0) {
    meters = km * 1000;
  }

  return { km: round(km), meters: round(meters, 1) };
}

export async function runDataIntegrityRepair() {
  const report = {
    objectivesDates: 0,
    projectsDates: 0,
    sportDistances: 0,
    brokenSportLinks: 0,
    orphanSportSets: 0,
    staleWorkouts: 0
  };

  const [objectives, projects, sessions, planSessions, sets] = await Promise.all([
    getAll("objectives"),
    getAll("projects"),
    getAll("sportSessions"),
    getAll("sportPlanSessions"),
    getAll("sportSets")
  ]);

  for (const objective of objectives) {
    if (objective.startDate && objective.targetDate && objective.targetDate < objective.startDate) {
      await putOne("objectives", {
        ...objective,
        targetDate: "",
        integrityNote: "Échéance antérieure à la date de départ : échéance retirée automatiquement.",
        updatedAt: new Date().toISOString()
      });
      report.objectivesDates++;
    }
  }

  for (const project of projects) {
    if (project.startDate && project.targetDate && project.targetDate < project.startDate) {
      await putOne("projects", {
        ...project,
        targetDate: "",
        integrityNote: "Échéance antérieure à la date de départ : échéance retirée automatiquement.",
        updatedAt: new Date().toISOString()
      });
      report.projectsDates++;
    }
  }

  const sessionIds = new Set(sessions.map(session => session.id));

  for (const session of sessions) {
    let patch = {};
    const id = canonicalSportId(session.sportId || session.activityType || session.programName || session.sport || "");
    if (id && session.sportId !== id) {
      patch.sportId = id;
      if (session.type === "activity") patch.activityType = sportLabel(id);
    }

    if (session.type === "activity") {
      const distance = normalizedDistance(session);
      if (Math.abs(Number(session.distanceKm || 0) - distance.km) > 0.0001 ||
          Math.abs(Number(session.distanceMeters || 0) - distance.meters) > 0.1) {
        patch.distanceKm = distance.km;
        patch.distanceMeters = distance.meters;
        report.sportDistances++;
      }
    }

    if (session.status === "in_progress") {
      const started = new Date(session.startedAt || session.createdAt || 0).getTime();
      if (started && Date.now() - started > 12 * 3600 * 1000) {
        patch.staleWorkout = true;
        report.staleWorkouts++;
      }
    }

    if (Object.keys(patch).length) {
      await putOne("sportSessions", {
        ...session,
        ...patch,
        updatedAt: new Date().toISOString()
      });
    }
  }

  for (const planSession of planSessions) {
    const patch = {};

    if (planSession.activitySessionId && !sessionIds.has(planSession.activitySessionId)) {
      patch.activitySessionId = null;
      patch.integrityWarning = "La séance réelle liée n'existe plus.";
      report.brokenSportLinks++;
    }

    const meters = Number(planSession.actualDistanceMeters || 0);
    const km = Number(planSession.actualDistanceKm || 0);
    if (meters > 0 && Math.abs(km - meters / 1000) > 0.0001) {
      patch.actualDistanceKm = round(meters / 1000);
      report.sportDistances++;
    } else if (km > 0 && meters <= 0) {
      patch.actualDistanceMeters = round(km * 1000, 1);
      report.sportDistances++;
    }

    if (Number(planSession.targetDistanceMeters || 0) > 0) {
      const expectedKm = Number(planSession.targetDistanceMeters) / 1000;
      if (Math.abs(Number(planSession.targetDistanceKm || 0) - expectedKm) > 0.0001) {
        patch.targetDistanceKm = round(expectedKm);
        report.sportDistances++;
      }
    }

    if (Object.keys(patch).length) {
      await putOne("sportPlanSessions", {
        ...planSession,
        ...patch,
        updatedAt: new Date().toISOString()
      });
    }
  }

  for (const set of sets) {
    if (!sessionIds.has(set.sessionId)) {
      await deleteOne("sportSets", set.id);
      report.orphanSportSets++;
    }
  }

  await putOne("settings", {
    key: "integrity.lastReport",
    value: report,
    updatedAt: new Date().toISOString()
  });

  return report;
}
