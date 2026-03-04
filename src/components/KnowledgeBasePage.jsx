import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Clock3,
  Layers3,
  User,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  KNOWLEDGE_BASE_ARTICLES,
  KNOWLEDGE_BASE_LEVEL_LABEL,
} from '@/lib/knowledgeBaseArticles';
import guideQuickStart from '../../docs/learning-center/00-quick-start-15-minit.md?raw';
import guide01 from '../../docs/learning-center/01-pengenalan-dan-aliran-kerja.md?raw';
import guide02 from '../../docs/learning-center/02-dashboard-operasi.md?raw';
import guide03 from '../../docs/learning-center/03-inventori-dan-item.md?raw';
import guide04 from '../../docs/learning-center/04-invois-dan-jualan.md?raw';
import guide05 from '../../docs/learning-center/05-pelanggan.md?raw';
import guide06 from '../../docs/learning-center/06-wallet-dan-resit.md?raw';
import guide07 from '../../docs/learning-center/07-reminder.md?raw';
import guide08 from '../../docs/learning-center/08-katalog-awam.md?raw';
import guide09 from '../../docs/learning-center/09-tetapan-sistem.md?raw';
import guide10 from '../../docs/learning-center/10-data-safety-backup-restore.md?raw';
import guide11 from '../../docs/learning-center/11-faq-dan-troubleshooting.md?raw';
import guideAdvanced from '../../docs/learning-center/12-advanced-guide.md?raw';

const THEME_CARD_CLASS = {
  cyan: 'border-cyan-200 bg-gradient-to-br from-cyan-100/90 via-cyan-50 to-slate-100',
  violet: 'border-violet-200 bg-gradient-to-br from-violet-100/90 via-violet-50 to-slate-100',
  rose: 'border-rose-200 bg-gradient-to-br from-rose-100/90 via-rose-50 to-slate-100',
  emerald: 'border-emerald-200 bg-gradient-to-br from-emerald-100/90 via-emerald-50 to-slate-100',
  sky: 'border-sky-200 bg-gradient-to-br from-sky-100/90 via-sky-50 to-slate-100',
  amber: 'border-amber-200 bg-gradient-to-br from-amber-100/90 via-amber-50 to-slate-100',
  teal: 'border-teal-200 bg-gradient-to-br from-teal-100/90 via-teal-50 to-slate-100',
  indigo: 'border-indigo-200 bg-gradient-to-br from-indigo-100/90 via-indigo-50 to-slate-100',
  fuchsia: 'border-fuchsia-200 bg-gradient-to-br from-fuchsia-100/90 via-fuchsia-50 to-slate-100',
  slate: 'border-slate-200 bg-gradient-to-br from-slate-100/90 via-slate-50 to-slate-100',
  orange: 'border-orange-200 bg-gradient-to-br from-orange-100/90 via-orange-50 to-slate-100',
  pink: 'border-pink-200 bg-gradient-to-br from-pink-100/90 via-pink-50 to-slate-100',
  purple: 'border-purple-200 bg-gradient-to-br from-purple-100/90 via-purple-50 to-slate-100',
};

const GUIDE_CONTENT_BY_ID = {
  'quick-start-15': guideQuickStart,
  'asas-aliran': guide01,
  'dashboard-operasi': guide02,
  'inventori-item': guide03,
  'invois-jualan': guide04,
  pelanggan: guide05,
  'wallet-resit': guide06,
  reminder: guide07,
  'katalog-awam': guide08,
  'tetapan-sistem': guide09,
  'data-safety': guide10,
  'faq-troubleshooting': guide11,
  'advanced-guide': guideAdvanced,
};

const SIMPLE_KB_FILTERS = [
  {
    id: 'all',
    label: 'Semua Topik',
    match: () => true,
  },
  {
    id: 'mula-cepat',
    label: 'Mula Cepat',
    match: (article) => article.level === 'quick-start' || article.tags.includes('mula cepat'),
  },
  {
    id: 'operasi',
    label: 'Operasi Harian',
    match: (article) =>
      article.tags.includes('operasi harian')
      || article.tags.includes('workflow')
      || article.tags.includes('dashboard'),
  },
  {
    id: 'invois-jualan',
    label: 'Invois & Jualan',
    match: (article) =>
      article.tags.includes('invois')
      || article.tags.includes('jualan')
      || article.tags.includes('platform jualan'),
  },
  {
    id: 'wallet-resit',
    label: 'Wallet & Resit',
    match: (article) =>
      article.tags.includes('wallet')
      || article.tags.includes('resit')
      || article.tags.includes('cashflow'),
  },
  {
    id: 'backup-restore',
    label: 'Backup & Restore',
    match: (article) =>
      article.tags.includes('backup')
      || article.tags.includes('restore')
      || article.tags.includes('disaster'),
  },
  {
    id: 'advanced',
    label: 'Advanced',
    match: (article) => article.level === 'advanced' || article.tags.includes('advanced'),
  },
];

const renderInlineMarkdown = (text) => {
  const tokens = String(text || '')
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean);

  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={`b-${index}`} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code
          key={`c-${index}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={`t-${index}`}>{token}</React.Fragment>;
  });
};

const parseGuideBlocks = (content) => {
  const lines = String(content || '').split('\n');
  const blocks = [];

  const isSpecialLine = (line) => (
    /^#{1,3}\s/.test(line)
    || /^\d+\.\s/.test(line)
    || /^-\s/.test(line)
    || /^>\s/.test(line)
    || /^---+$/.test(line)
  );

  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4) });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3) });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2) });
      index += 1;
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s/, ''));
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const items = [];
      while (index < lines.length && lines[index].trim().startsWith('- ')) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines = [];
      while (index < lines.length && lines[index].trim().startsWith('> ')) {
        quoteLines.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || isSpecialLine(next)) break;
      paragraphLines.push(next);
      index += 1;
    }
    blocks.push({ type: 'p', text: paragraphLines.join(' ') });
  }

  return blocks;
};

const renderGuideBlock = (block, index) => {
  if (block.type === 'h1') {
    return (
      <h2 key={`h1-${index}`} className="text-2xl font-bold tracking-tight text-slate-900">
        {renderInlineMarkdown(block.text)}
      </h2>
    );
  }

  if (block.type === 'h2') {
    return (
      <div key={`h2-${index}`} className="mt-4 border-t border-primary/15 pt-4">
        <h3 className="text-lg font-semibold text-primary">{renderInlineMarkdown(block.text)}</h3>
      </div>
    );
  }

  if (block.type === 'h3') {
    return (
      <h4 key={`h3-${index}`} className="text-base font-semibold text-slate-800">
        {renderInlineMarkdown(block.text)}
      </h4>
    );
  }

  if (block.type === 'ol') {
    return (
      <div key={`ol-${index}`} className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-3">
        <ol className="space-y-2">
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-ol-${itemIndex}`} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {itemIndex + 1}
              </span>
              <span className="pt-0.5">{renderInlineMarkdown(item)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (block.type === 'ul') {
    return (
      <div key={`ul-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
        <ul className="space-y-2">
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-ul-${itemIndex}`} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              <span>{renderInlineMarkdown(item)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.type === 'quote') {
    return (
      <blockquote
        key={`q-${index}`}
        className="rounded-xl border-l-4 border-primary/40 bg-slate-50 px-4 py-3 text-sm italic text-slate-700"
      >
        {renderInlineMarkdown(block.text)}
      </blockquote>
    );
  }

  if (block.type === 'hr') {
    return <div key={`hr-${index}`} className="my-1 h-px w-full bg-border" />;
  }

  return (
    <p key={`p-${index}`} className="text-sm leading-7 text-slate-700">
      {renderInlineMarkdown(block.text)}
    </p>
  );
};

const KnowledgeArticleDetail = ({
  selectedArticle,
  selectedGuideContent,
  AudienceBadgeIcon,
  onOpenGuide,
  className = '',
}) => {
  if (!selectedArticle) {
    return (
      <div className={cn('flex min-h-[220px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground', className)}>
        <BookOpen className="h-8 w-8 text-cyan-600" />
        Tiada panduan sepadan dengan penapis semasa.
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 rounded-[22px] border border-primary/20 bg-white p-4 shadow-sm sm:p-5', className)}>
      <div className="space-y-1.5">
        <p className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          <Layers3 className="h-3.5 w-3.5" />
          {KNOWLEDGE_BASE_LEVEL_LABEL[selectedArticle.level] || 'Modul'}
        </p>
        <h2 className="text-xl font-bold text-slate-900">{selectedArticle.title}</h2>
        <p className="text-sm text-slate-600">{selectedArticle.summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-slate-50 px-2.5 py-2 text-slate-700">
          <p className="font-semibold text-slate-900">Durasi</p>
          <p>{selectedArticle.duration}</p>
        </div>
        <div className="rounded-lg border border-border bg-slate-50 px-2.5 py-2 text-slate-700">
          <p className="font-semibold text-slate-900">Audience</p>
          <p className="inline-flex items-center gap-1">
            <AudienceBadgeIcon className="h-3.5 w-3.5" />
            {selectedArticle.audience === 'baru'
              ? 'User Baru'
              : selectedArticle.audience === 'lama'
                ? 'User Lama'
                : 'Semua User'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Fokus Utama
        </p>
        <ul className="space-y-1 text-sm text-slate-700">
          {selectedArticle.highlights.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Langkah Ringkas
        </p>
        <ol className="space-y-1.5 text-sm text-slate-700">
          {selectedArticle.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-2">
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-slate-700">
        Dokumen asal: <span className="font-medium text-primary">{selectedArticle.guidePath}</span>
      </div>
      <Button
        type="button"
        onClick={onOpenGuide}
        className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-cyan-600"
        disabled={!selectedGuideContent}
      >
        Open Full Guide
      </Button>
    </div>
  );
};

const KnowledgeBasePage = () => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedArticleId, setSelectedArticleId] = useState(KNOWLEDGE_BASE_ARTICLES[0]?.id || '');
  const [isMobileDetailVisible, setIsMobileDetailVisible] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const filteredArticles = useMemo(() => {
    const active = SIMPLE_KB_FILTERS.find((filter) => filter.id === activeFilter);
    if (!active) return KNOWLEDGE_BASE_ARTICLES;
    return KNOWLEDGE_BASE_ARTICLES.filter((article) => active.match(article));
  }, [activeFilter]);

  const selectedArticle = useMemo(() => {
    const fromFiltered = filteredArticles.find((article) => article.id === selectedArticleId);
    if (fromFiltered) return fromFiltered;
    return filteredArticles[0] || null;
  }, [filteredArticles, selectedArticleId]);

  useEffect(() => {
    if (!filteredArticles.some((article) => article.id === selectedArticleId)) {
      setIsMobileDetailVisible(false);
      setSelectedArticleId(filteredArticles[0]?.id || '');
    }
  }, [filteredArticles, selectedArticleId]);

  const selectedGuideContent = useMemo(
    () => (selectedArticle ? (GUIDE_CONTENT_BY_ID[selectedArticle.id] || '') : ''),
    [selectedArticle]
  );
  const guideBlocks = useMemo(
    () => parseGuideBlocks(selectedGuideContent),
    [selectedGuideContent]
  );

  const audienceBadgeIcon = selectedArticle?.audience === 'baru' ? User : Users;
  const AudienceBadgeIcon = audienceBadgeIcon || Users;

  return (
    <div className="space-y-6 pb-8">
      <div className="relative rounded-[36px] border border-primary/20 bg-gradient-to-br from-slate-50 via-slate-100/70 to-cyan-50/40 p-3 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan-200/35 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-16 left-28 h-44 w-44 rounded-full bg-violet-200/25 blur-2xl" />
        <div className="grid gap-5">
          <section className="grid gap-5 overflow-visible rounded-[28px] border border-slate-200 bg-[#f3f4f7]/90 p-4 sm:p-6 lg:grid-cols-12 lg:items-start">
            <div className="min-w-0 space-y-4 lg:col-span-8">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Knowledge Base</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tutorial Rarebits untuk user baru dan lama, berdasarkan Learning Center.
                  </p>
                </div>
                <div className="rounded-xl border border-primary/20 bg-white px-3 py-2 text-xs text-muted-foreground shadow-sm">
                  {filteredArticles.length} panduan dipaparkan
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {SIMPLE_KB_FILTERS.map((filter) => (
                  <Button
                    key={filter.id}
                    type="button"
                    variant="outline"
                    onClick={() => setActiveFilter(filter.id)}
                    className={cn(
                      'h-10 rounded-xl border px-5 text-sm hover:bg-primary/10 hover:text-primary',
                      activeFilter === filter.id
                        ? 'border-primary/55 bg-primary/10 font-semibold text-primary shadow-sm hover:bg-primary/15'
                        : 'border-slate-300 bg-white text-slate-500 hover:border-primary/40'
                    )}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {filteredArticles.map((article) => (
                <React.Fragment key={article.id}>
                  <Card
                    className={cn(
                      'group cursor-pointer overflow-hidden border transition-all hover:-translate-y-0.5 hover:shadow-md',
                      THEME_CARD_CLASS[article.theme] || THEME_CARD_CLASS.cyan,
                      selectedArticle?.id === article.id ? 'ring-2 ring-primary/30' : 'ring-0'
                    )}
                    onClick={() => {
                      setSelectedArticleId(article.id);
                      setIsMobileDetailVisible(true);
                    }}
                  >
                    <CardContent className="relative min-h-[220px] p-4">
                      <div className="pointer-events-none absolute right-3 top-3 h-14 w-14 rounded-full bg-white/40 blur-md" />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary shadow-sm">
                          {KNOWLEDGE_BASE_LEVEL_LABEL[article.level] || 'Modul'}
                        </span>
                        <span className="rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">
                          {article.duration}
                        </span>
                      </div>
                      <div className="mt-10 rounded-2xl border border-white/70 bg-white/90 p-3 backdrop-blur-sm">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          {article.audience === 'baru' ? 'User Baru' : article.audience === 'lama' ? 'User Lama' : 'Semua User'}
                        </p>
                        <h3 className="mt-1 line-clamp-2 text-base font-semibold text-slate-900">
                          {article.title}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                          {article.summary}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-white/70 pt-2 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {article.duration}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700 transition-colors group-hover:text-primary">
                          <BookOpen className="h-3.5 w-3.5" />
                          Buka Panduan
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {isMobileDetailVisible && selectedArticle?.id === article.id ? (
                    <KnowledgeArticleDetail
                      selectedArticle={selectedArticle}
                      selectedGuideContent={selectedGuideContent}
                      AudienceBadgeIcon={AudienceBadgeIcon}
                      onOpenGuide={() => setIsGuideOpen(true)}
                      className="lg:hidden sm:col-span-2"
                    />
                  ) : null}
                </React.Fragment>
              ))}
            </div>
            </div>

          <aside className="hidden lg:col-span-4 lg:block lg:self-start lg:sticky lg:top-24">
            <KnowledgeArticleDetail
              selectedArticle={selectedArticle}
              selectedGuideContent={selectedGuideContent}
              AudienceBadgeIcon={AudienceBadgeIcon}
              onOpenGuide={() => setIsGuideOpen(true)}
              className="lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
            />
          </aside>
          </section>
        </div>
      </div>
      {isGuideOpen ? (
        <AlertDialog open={isGuideOpen} onOpenChange={setIsGuideOpen}>
          <AlertDialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-hidden p-0">
            <AlertDialogHeader className="border-b border-border bg-gradient-to-r from-slate-50 to-cyan-50 px-6 py-4 text-left">
              <AlertDialogTitle className="flex items-center gap-2 text-xl text-slate-900">
                <BookOpen className="h-5 w-5 text-primary" />
                {selectedArticle?.title || 'Panduan'}
              </AlertDialogTitle>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-primary/20 bg-white px-3 py-1 text-xs font-semibold text-primary">
                  {KNOWLEDGE_BASE_LEVEL_LABEL[selectedArticle?.level] || 'Modul'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                  {selectedArticle?.duration || '-'}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                  {selectedArticle?.audience === 'baru'
                    ? 'User Baru'
                    : selectedArticle?.audience === 'lama'
                      ? 'User Lama'
                      : 'Semua User'}
                </span>
              </div>
            </AlertDialogHeader>
            <div className="max-h-[72vh] overflow-y-auto bg-slate-50/60 px-6 py-5">
              {selectedGuideContent ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-primary/15 bg-white p-4 shadow-sm">
                    <p className="text-sm leading-7 text-slate-700">{selectedArticle?.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(selectedArticle?.tags || []).slice(0, 8).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    {guideBlocks.map((block, index) => renderGuideBlock(block, index))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Kandungan panduan belum tersedia.</p>
              )}
            </div>
            <AlertDialogFooter className="border-t border-border px-6 py-4">
              <AlertDialogCancel className="mt-0">Tutup</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
};

export default KnowledgeBasePage;
