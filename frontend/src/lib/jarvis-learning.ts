export interface JarvisLesson {
  id: string;
  prompt: string;
  response: string;
  createdAt: number;
  status: 'pending';
  source: 'teach-mode';
}

const STORAGE_KEY = 'jarvis.learning.pending.v1';
const MAX_LESSONS = 500;
const MAX_TEXT = 12000;

function readLessons(): JarvisLesson[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) =>
      item && typeof item.prompt === 'string' && typeof item.response === 'string'
      && item.status === 'pending'
    ) : [];
  } catch {
    return [];
  }
}

/** Save a local candidate example. It is not training and is never uploaded. */
export function savePendingLesson(prompt: string, response: string): JarvisLesson {
  const cleanPrompt = prompt.trim().slice(0, MAX_TEXT);
  const cleanResponse = response.trim().slice(0, MAX_TEXT);
  if (!cleanPrompt || !cleanResponse) throw new Error('A lesson needs both a prompt and a response.');
  const lesson: JarvisLesson = {
    id: globalThis.crypto?.randomUUID?.() ?? `lesson-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    prompt: cleanPrompt,
    response: cleanResponse,
    createdAt: Date.now(),
    status: 'pending',
    source: 'teach-mode',
  };
  const next = [...readLessons(), lesson].slice(-MAX_LESSONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return lesson;
}

export function listPendingLessons(): JarvisLesson[] {
  return readLessons();
}

export function removePendingLesson(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readLessons().filter((lesson) => lesson.id !== id)));
}

export function clearPendingLessons(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportPendingLessonsJsonl(): string {
  return readLessons().map((lesson) => JSON.stringify({
    id: lesson.id,
    category: 'user_taught',
    consent: 'user-approved-export',
    messages: [
      { role: 'user', content: lesson.prompt },
      { role: 'assistant', content: lesson.response },
    ],
  })).join('\n');
}
