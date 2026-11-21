/**
 * The lesson catalog. Every `.md` file in this folder is bundled at build time
 * (`?raw`), parsed once, and listed on the landing page — so adding a lesson is
 * adding a markdown file, with no other code to touch.
 */
import { parseLessonDoc } from './frontmatter';
import type { Lesson } from './types';

const sources = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const LESSONS: Lesson[] = Object.entries(sources)
  .map(([path, source]) => parseLessonDoc(source, path.replace('./', '')))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const lessonById = (id: string | null): Lesson | null =>
  id ? LESSONS.find((lesson) => lesson.id === id) ?? null : null;

export const lessonCount = LESSONS.length;
