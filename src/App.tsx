import { useEffect, useState } from 'react';
import type { Lang } from './i18n';
import { LESSONS, lessonById } from './lessons';
import { TopBar } from './components/TopBar';
import { Landing } from './components/Landing';
import { LessonWorkspace } from './components/LessonWorkspace';

// Legacy storage keys from before the rename — kept so saved language, theme and
// lesson progress still resolve after a visit to the renamed build.
const LANG_KEY = 'visna-sol:lang';
const THEME_KEY = 'visna-sol:theme';
const LESSON_HASH = /^#\/lesson\/([A-Za-z0-9_-]+)/;

const readLang = (): Lang => {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
};

/** Dark (Navy & Lavender) is the HD2Lab default; the iris light theme is the toggle. */
const readTheme = (): 'dark' | 'light' => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const lessonIdFromHash = (hash: string): string | null => {
  const match = LESSON_HASH.exec(hash);
  return match ? match[1] : null;
};

export default function App() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const [lessonId, setLessonId] = useState<string | null>(() => lessonIdFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setLessonId(lessonIdFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B1020' : '#FAFAFD');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, lang]);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const lesson = lessonById(lessonId);
  const openLesson = (id: string) => {
    window.location.hash = `#/lesson/${id}`;
    setLessonId(id);
  };
  const goHome = () => {
    if (window.location.hash) window.location.hash = '#/';
    setLessonId(null);
  };

  if (lesson) {
    return (
      <LessonWorkspace
        key={lesson.id}
        lesson={lesson}
        lang={lang}
        theme={theme}
        onLang={setLang}
        onTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onHome={goHome}
      />
    );
  }

  return (
    <div className="app app-landing">
      <TopBar
        lang={lang}
        onLang={setLang}
        theme={theme}
        onTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onHome={goHome}
      />
      <Landing lang={lang} lessons={LESSONS} onOpen={openLesson} />
    </div>
  );
}
