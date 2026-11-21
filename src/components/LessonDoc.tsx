/**
 * The left pane's reading material: a deliberately small Markdown renderer for
 * the shapes lessons use — headings, paragraphs, lists, quotes, fenced code and
 * tables. Tables are the reason this is hand-written: on a 296 px column (and on
 * a phone) they scroll sideways inside their own wrapper instead of pushing the
 * whole page wide.
 */
import type { ReactNode } from 'react';
import { t, type Lang } from '../i18n';
import type { Lesson } from '../lessons/types';

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
const SAFE_URL = /^(https?:\/\/|#|\/|\.\/|mailto:)/i;

export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const key = `${keyPrefix}-${index}`;
    index += 1;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="doc-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const [, label, href] = link;
        nodes.push(
          SAFE_URL.test(href) ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ) : (
            <span key={key}>{label}</span>
          ),
        );
      }
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
};

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' };

const startsBlock = (line: string): boolean =>
  /^```/.test(line) ||
  /^#{1,6}\s+/.test(line) ||
  /^[-*]\s+/.test(line) ||
  /^\d+\.\s+/.test(line) ||
  /^>\s?/.test(line) ||
  /^(---|\*\*\*)$/.test(line.trim()) ||
  line.trim().startsWith('|');

/** Split a lesson body into blocks — exported so the unit suite can assert it. */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', lang, lines: body });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }
    if (/^(---|\*\*\*)\s*$/.test(line.trim())) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1].trim())) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, '').trim());
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, '').trim());
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, '').trim());
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }
    // paragraph: run until a blank line or the start of another block
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !(paragraph.length > 0 && startsBlock(lines[i]))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case 'heading': {
            const Tag = (block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4';
            return (
              <Tag key={key} className={`doc-h doc-h${block.level}`}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={key} className="doc-p">
                {renderInline(block.text, key)}
              </p>
            );
          case 'code':
            return (
              <div key={key} className="doc-code-wrap">
                {block.lang && <span className="doc-code-lang">{block.lang}</span>}
                <pre className="doc-code">
                  <code>{block.lines.join('\n')}</code>
                </pre>
              </div>
            );
          case 'ul':
            return (
              <ul key={key} className="doc-list">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="doc-list doc-ordered">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={key} className="doc-quote">
                {block.lines.map((line, lineIndex) => (
                  <p key={`${key}-${lineIndex}`}>{renderInline(line, `${key}-${lineIndex}`)}</p>
                ))}
              </blockquote>
            );
          case 'table':
            return (
              <div key={key} className="md-table-wrap" data-testid="doc-table">
                <table className="doc-table">
                  <thead>
                    <tr>
                      {block.head.map((cell, cellIndex) => (
                        <th key={cellIndex}>{renderInline(cell, `${key}-h${cellIndex}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{renderInline(cell, `${key}-${rowIndex}-${cellIndex}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <hr key={key} className="doc-hr" />;
          default:
            return null;
        }
      })}
    </>
  );
}

export function LessonDoc({ lesson, lang }: { lesson: Lesson; lang: Lang }) {
  return (
    <article className="lesson-doc" data-testid="lesson-doc">
      <header className="doc-head">
        <span className="doc-eyebrow">
          {t(lang, 'docTitle')} · {lesson.level[lang]} · {lesson.runtime === 'git' ? t(lang, 'runtimeGit') : t(lang, 'runtimePython')}
        </span>
        <h2 className="doc-title">{lesson.title[lang]}</h2>
        <p className="doc-subtitle">{lesson.subtitle[lang]}</p>
      </header>
      <div className="doc-body">
        <Markdown source={lesson.body} />
      </div>
    </article>
  );
}
