import { getAll, getOne, putOne } from "./db.js";

export async function learningMinutesForTopic(topicId) {
  const sessions = await getAll("learningSessions");
  return sessions
    .filter(session => session.topicId === topicId)
    .reduce((sum, session) => sum + Number(session.minutes || 0), 0);
}

export async function syncLearningObjective(topicId = null) {
  const [topics, sessions] = await Promise.all([
    getAll("learningTopics"),
    getAll("learningSessions")
  ]);

  const candidates = topics.filter(topic =>
    topic.objectiveId &&
    topic.syncObjective !== false &&
    (!topicId || topic.id === topicId)
  );

  for (const topic of candidates) {
    const objective = await getOne("objectives", topic.objectiveId);
    if (!objective) continue;

    const minutes = sessions
      .filter(session => session.topicId === topic.id)
      .reduce((sum, session) => sum + Number(session.minutes || 0), 0);

    const currentHours = Math.round((minutes / 60) * 100) / 100;
    const targetHours = Number(topic.targetHours || objective.targetValue || 0);

    await putOne("objectives", {
      ...objective,
      projectId: topic.projectId || objective.projectId || null,
      progressMode: "numeric",
      startValue: 0,
      currentValue: currentHours,
      targetValue: targetHours,
      unit: "h",
      updatedAt: new Date().toISOString()
    });
  }
}
