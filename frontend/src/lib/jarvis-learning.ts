export interface JarvisLesson {
  id: string;
  prompt: string;
  suggestedResponse: string;
  targetResponse: string;
  createdAt: number;
  status: 'pending' | 'approved';
  source: 'teach-mode';
}

const LESSONS_KEY = 'jarvis.learning.pending.v2';
const INSTRUCTIONS_KEY = 'jarvis.learning.instructions.v1';
const MAX_LESSONS = 500;
const MAX_INSTRUCTIONS = 100;
const MAX_TEXT = 12000;

function readLessons(): JarvisLesson[] {
  try {
    const legacy = JSON.parse(localStorage.getItem('jarvis.learning.pending.v1') || '[]');
    const parsed = JSON.parse(localStorage.getItem(LESSONS_KEY) || 'null') ?? (Array.isArray(legacy) ? legacy.map((item: any) => ({ ...item, suggestedResponse: item.response, targetResponse: '', status: 'pending' })) : []);
    return Array.isArray(parsed) ? parsed.filter((item) =>
      item && typeof item.id === 'string' && typeof item.prompt === 'string'
      && typeof item.suggestedResponse === 'string'
      && (item.status === 'pending' || item.status === 'approved')
      && typeof item.targetResponse === 'string'
    ) : [];
  } catch { return []; }
}

function readInstructions(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(INSTRUCTIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()).slice(-MAX_INSTRUCTIONS) : [];
  } catch { return []; }
}

/** Save a user-authored instruction locally for immediate retrieval in local chats. */
export function saveTeachingInstruction(text: string): void {
  const clean = text.trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error('Instruction cannot be empty.');
  const current = readInstructions();
  if (current.some((item) => item.toLocaleLowerCase() === clean.toLocaleLowerCase())) return;
  localStorage.setItem(INSTRUCTIONS_KEY, JSON.stringify([...current, clean].slice(-MAX_INSTRUCTIONS)));
}

export function listTeachingInstructions(): string[] { return readInstructions(); }

export function removeTeachingInstruction(index: number): void {
  localStorage.setItem(INSTRUCTIONS_KEY, JSON.stringify(readInstructions().filter((_, i) => i !== index)));
}

/** Save the model's answer as a suggestion only. It is NOT training data until corrected/approved. */
export function savePendingLesson(prompt: string, suggestedResponse: string): JarvisLesson {
  const cleanPrompt = prompt.trim().slice(0, MAX_TEXT);
  const cleanResponse = suggestedResponse.trim().slice(0, MAX_TEXT);
  if (!cleanPrompt || !cleanResponse) throw new Error('A lesson needs both a prompt and a suggested response.');
  const lesson: JarvisLesson = {
    id: globalThis.crypto?.randomUUID?.() ?? `lesson-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    prompt: cleanPrompt,
    suggestedResponse: cleanResponse,
    targetResponse: '',
    createdAt: Date.now(),
    status: 'pending',
    source: 'teach-mode',
  };
  const next = [...readLessons(), lesson].slice(-MAX_LESSONS);
  localStorage.setItem(LESSONS_KEY, JSON.stringify(next));
  return lesson;
}

export function listPendingLessons(): JarvisLesson[] { return readLessons(); }

/**
 * Return a small, deterministic set of user-approved examples for local
 * retrieval-augmented learning. These examples influence prompts immediately;
 * they do not modify GGUF weights or treat unapproved suggestions as truth.
 */
export function getApprovedLearningExamples(query: string, limit = 4): Array<{ prompt: string; answer: string }> {
  const terms = new Set((query.toLocaleLowerCase().match(/[\\p{L}\\p{N}]{3,}/gu) ?? []));
  const approved = readLessons()
    .filter((lesson) => lesson.status === 'approved' && lesson.targetResponse.trim())
    .map((lesson) => {
      const promptTerms = (lesson.prompt.toLocaleLowerCase().match(/[\\p{L}\\p{N}]{3,}/gu) ?? []);
      const overlap = promptTerms.reduce((score, term) => score + (terms.has(term) ? 1 : 0), 0);
      return { lesson, score: overlap };
    });
  approved.sort((a, b) => b.score - a.score || b.lesson.createdAt - a.lesson.createdAt);
  const selected = approved.slice(0, Math.max(0, Math.min(6, limit)));
  const result: Array<{ prompt: string; answer: string }> = [];
  let budget = 6000;
  for (const { lesson } of selected) {
    const prompt = lesson.prompt.slice(0, 1800);
    const answer = lesson.targetResponse.slice(0, 2400);
    const cost = prompt.length + answer.length;
    if (cost > budget) continue;
    result.push({ prompt, answer });
    budget -= cost;
  }
  return result;
}

export function approvePendingLesson(id: string, targetResponse: string): void {
  const answer = targetResponse.trim().slice(0, MAX_TEXT);
  if (!answer) throw new Error('Write the correct target answer before approving this example.');
  const next = readLessons().map((lesson) => lesson.id === id
    ? { ...lesson, targetResponse: answer, status: 'approved' as const }
    : lesson);
  localStorage.setItem(LESSONS_KEY, JSON.stringify(next));
}

export function removePendingLesson(id: string): void {
  localStorage.setItem(LESSONS_KEY, JSON.stringify(readLessons().filter((lesson) => lesson.id !== id)));
}

export function clearPendingLessons(): void { localStorage.removeItem(LESSONS_KEY); }

export function exportPendingLessonsJsonl(): string {
  return readLessons().filter((lesson) => lesson.status === 'approved' && lesson.targetResponse.trim()).map((lesson) => JSON.stringify({
    id: lesson.id,
    category: 'user_taught',
    consent: 'user-approved-export',
    messages: [
      { role: 'user', content: lesson.prompt },
      { role: 'assistant', content: lesson.targetResponse },
    ],
  })).join('\n');
}
