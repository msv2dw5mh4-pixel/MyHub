import { getAll, getOne, putOne } from "./db.js";
import { uid, todayISO } from "./ui.js";

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function iso(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
}

function addDays(dateString, days) {
  const d = localDate(dateString);
  d.setDate(d.getDate() + Number(days || 0));
  return iso(d);
}

function nextAnnualOccurrence(monthDay, fromDate = todayISO()) {
  if (!monthDay) return null;
  const parts = String(monthDay).split("-");
  const month = Number(parts.length === 3 ? parts[1] : parts[0]);
  const day = Number(parts.length === 3 ? parts[2] : parts[1]);
  if (!month || !day) return null;

  const from = localDate(fromDate);
  let year = from.getFullYear();
  let candidate = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  if (candidate < fromDate) {
    year += 1;
    candidate = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  return candidate;
}

function personName(person) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || person.nickname || "Une personne";
}

function reminderAtFor(date, daysBefore) {
  const reminderDate = addDays(date, -Math.max(0, Number(daysBefore || 0)));
  return `${reminderDate}T09:00`;
}

async function dismissedKeys() {
  const row = await getOne("settings", "people.dismissedReminders");
  return new Set(Array.isArray(row?.value) ? row.value : []);
}

export async function dismissPeopleReminderTask(task) {
  if (!task?.peopleReminderKey) return;
  const row = await getOne("settings", "people.dismissedReminders");
  const values = Array.isArray(row?.value) ? row.value : [];
  if (!values.includes(task.peopleReminderKey)) values.push(task.peopleReminderKey);
  await putOne("settings", {
    key: "people.dismissedReminders",
    value: values.slice(-500)
  });
}

export async function syncPeopleReminderTasks() {
  const [peopleRaw, eventsRaw, tasksRaw, dismissed] = await Promise.all([
    getAll("people"),
    getAll("peopleEvents"),
    getAll("tasks"),
    dismissedKeys()
  ]);

  const people = peopleRaw.filter(p => p.active !== false);
  const personMap = new Map(people.map(p => [p.id, p]));
  const existingKeys = new Set(tasksRaw.map(t => t.peopleReminderKey).filter(Boolean));
  const today = todayISO();

  for (const person of people) {
    if (!person.birthday) continue;
    const occurrence = nextAnnualOccurrence(person.birthday, today);
    if (!occurrence) continue;

    const key = `birthday:${person.id}:${occurrence}`;
    if (existingKeys.has(key) || dismissed.has(key)) continue;

    const daysBefore = Number(person.birthdayReminderDays ?? 7);
    await putOne("tasks", {
      id: uid("task"),
      title: `🎂 Anniversaire de ${personName(person)}`,
      description: person.birthdayNote || `Anniversaire de ${personName(person)}.`,
      folder: "Personnes",
      dueDate: occurrence,
      reminderAt: reminderAtFor(occurrence, daysBefore),
      done: false,
      source: "people-reminder",
      personId: person.id,
      peopleReminderType: "birthday",
      peopleReminderKey: key,
      createdAt: new Date().toISOString()
    });
    existingKeys.add(key);
  }

  for (const event of eventsRaw.filter(e => e.active !== false)) {
    const person = personMap.get(event.personId);
    if (!person || !event.date) continue;

    let occurrence = event.date;
    if (event.recurrence === "yearly") {
      occurrence = nextAnnualOccurrence(event.date, today);
    } else if (occurrence < today) {
      continue;
    }

    if (!occurrence) continue;
    const key = `person-event:${event.id}:${occurrence}`;
    if (existingKeys.has(key) || dismissed.has(key)) continue;

    const daysBefore = Number(event.reminderDays ?? 1);
    await putOne("tasks", {
      id: uid("task"),
      title: `👤 ${event.title || "Événement"} · ${personName(person)}`,
      description: event.notes || `Événement concernant ${personName(person)}.`,
      folder: "Personnes",
      dueDate: occurrence,
      reminderAt: reminderAtFor(occurrence, daysBefore),
      done: false,
      source: "people-reminder",
      personId: person.id,
      peopleEventId: event.id,
      peopleReminderType: "event",
      peopleReminderKey: key,
      createdAt: new Date().toISOString()
    });
    existingKeys.add(key);
  }
}
