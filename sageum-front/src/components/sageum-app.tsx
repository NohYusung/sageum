'use client';

import {
  BookOpen,
  Check,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Library,
  Menu,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAgentJob,
  getAgentJob,
  type AgentJob,
  type AgentSource,
} from '@/lib/api';

type View = 'input' | 'collect' | 'result';
type LessonId = 'l1' | 'l2' | 'l3' | 'l4' | 'l5';

const DEFAULT_TOPIC = '트랜스포머 아키텍처가 어떻게 동작하는지 이해하기';

const examples = [
  '트랜스포머 아키텍처의 어텐션 메커니즘',
  '정보처리기사 필기 핵심 요약',
  '확산 모델(Diffusion)의 원리',
  '까치산역 신진하이텔 실거주 검토',
];

const demoSources: AgentSource[] = [
  { domain: 'arxiv.org', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' },
  { domain: 'jalammar.github.io', title: 'The Illustrated Transformer', url: 'https://jalammar.github.io/illustrated-transformer/' },
  { domain: 'd2l.ai', title: 'Dive into Deep Learning · Attention', url: 'https://d2l.ai/' },
  { domain: 'stanford.edu', title: 'CS224N · Self-Attention & Transformers', url: 'https://web.stanford.edu/class/cs224n/' },
  { domain: 'huggingface.co', title: 'Transformers Course', url: 'https://huggingface.co/learn' },
];

const steps = [
  { name: '탐색', detail: '웹 질의 확장', threshold: 0 },
  { name: '수집', detail: '소스 크롤', threshold: 18 },
  { name: '선별', detail: '금 추출', threshold: 44 },
  { name: '구조화', detail: '목차 생성', threshold: 72 },
  { name: '자료화', detail: '노트 생성', threshold: 90 },
];

const lessons: Array<{
  id: LessonId;
  module: string;
  title: string;
  minutes: string;
  lead: string;
}> = [
  {
    id: 'l1',
    module: 'M1 · 문제 정의',
    title: '흩어진 정보를 학습 가능한 단위로 바꾸기',
    minutes: '12분',
    lead: '검색 결과를 그대로 보여주는 것이 아니라, 주제 이해에 필요한 순서와 난이도로 재배열합니다.',
  },
  {
    id: 'l2',
    module: 'M1 · 자료 선별',
    title: '금 소스와 모래 소스 구분',
    minutes: '15분',
    lead: '출처, 중복도, 설명 밀도, 최신성을 기준으로 실제 학습에 쓸 수 있는 자료만 남깁니다.',
  },
  {
    id: 'l3',
    module: 'M2 · 커리큘럼 생성',
    title: '단계형 학습 목차 만들기',
    minutes: '18분',
    lead: '입문자는 개념과 용어부터, 중급자는 비교와 구현부터 시작하도록 경로를 다르게 설계합니다.',
  },
  {
    id: 'l4',
    module: 'M2 · 지식 노트',
    title: 'Markdown과 HTML 결과물로 저장',
    minutes: '16분',
    lead: '생성된 학습 자료는 Markdown 원본과 HTML 렌더링 결과를 함께 저장해 재사용성을 높입니다.',
  },
  {
    id: 'l5',
    module: 'M3 · 운영 흐름',
    title: '백엔드 job과 agent callback',
    minutes: '20분',
    lead: '프론트 요청은 백엔드 durable table에 남고, agent는 실행 결과를 callback으로 돌려줍니다.',
  },
];

function SageumMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sageum-gradient" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="oklch(83% 0.045 82)" />
          <stop offset="1" stopColor="oklch(64% 0.14 72)" />
        </linearGradient>
      </defs>
      <path d="M16 2 29 9v14l-13 7L3 23V9z" fill="url(#sageum-gradient)" />
      <path d="m16 9 6.5 3.5v7L16 23l-6.5-3.5v-7z" fill="oklch(99% 0.005 90)" />
      <circle cx="16" cy="16" r="2.6" fill="url(#sageum-gradient)" />
    </svg>
  );
}

function sourceDomain(source: AgentSource) {
  if (source.domain) return source.domain;
  if (!source.url) return 'web';
  try {
    return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

function sourceTitle(source: AgentSource, index: number) {
  return source.title || source.snippet || `수집된 소스 ${index + 1}`;
}

export function SageumApp() {
  const [view, setView] = useState<View>('input');
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('입문');
  const [format, setFormat] = useState('커리큘럼');
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [lessonId, setLessonId] = useState<LessonId>('l3');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeTopic = topic.trim() || DEFAULT_TOPIC;
  const activeLesson = lessons.find((lesson) => lesson.id === lessonId) ?? lessons[2];
  const isTerminal = job?.status === 'completed' || job?.status === 'failed';

  const displaySources = useMemo(() => {
    const sources = job?.sources?.length ? job.sources : demoSources;
    const visibleCount = job?.status === 'completed' ? sources.length : Math.max(1, Math.ceil((progress / 100) * sources.length));
    return sources.slice(0, visibleCount);
  }, [job, progress]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [topic]);

  useEffect(() => {
    if (view !== 'collect' || isTerminal) return;

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 4, 93);
        return next;
      });
    }, 450);

    return () => window.clearInterval(timer);
  }, [view, isTerminal]);

  useEffect(() => {
    if (!job || view !== 'collect' || isTerminal) return;

    const timer = window.setInterval(async () => {
      try {
        const next = await getAgentJob(job.id);
        setJob(next);
        if (next.status === 'completed') {
          setProgress(100);
          setView('result');
        }
        if (next.status === 'failed') {
          setProgress(100);
          setError(next.error || 'agent 작업이 실패했습니다.');
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : 'job 상태 조회에 실패했습니다.');
      }
    }, 1600);

    return () => window.clearInterval(timer);
  }, [job, view, isTerminal]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setView('collect');
    setProgress(6);
    setError(null);
    setJob(null);

    try {
      const created = await createAgentJob({
        topic: activeTopic,
        level,
        format,
      });
      setJob(created);

      if (created.status === 'completed') {
        setProgress(100);
        setView('result');
      }
      if (created.status === 'failed') {
        setProgress(100);
        setError(created.error || 'agent 작업이 실패했습니다.');
      }
    } catch (submitError) {
      setProgress(100);
      setError(submitError instanceof Error ? submitError.message : 'job 생성에 실패했습니다.');
    }
  }

  function navigate(next: View) {
    setView(next);
  }

  return (
    <div className="app-shell">
      <aside className="side">
        <button className="brand" type="button" onClick={() => navigate('input')}>
          <SageumMark />
          <span className="wordmark">
            SAGE<b>UM</b>
          </span>
        </button>

        <button className={`navitem ${view === 'input' ? 'active' : ''}`} type="button" onClick={() => navigate('input')}>
          <Search size={17} />
          새 검색
        </button>
        <button className={`navitem ${view === 'result' ? 'active' : ''}`} type="button" onClick={() => navigate('result')}>
          <BookOpen size={17} />
          내 커리큘럼
        </button>

        <div className="group-label">라이브러리</div>
        <button className="navitem" type="button" onClick={() => navigate('result')}>
          <Library size={17} />
          지식 저장소
        </button>
        <button className="navitem" type="button" onClick={() => navigate('collect')}>
          <Clock size={17} />
          작업 히스토리
        </button>

        <div className="side-spacer" />
        <div className="account">
          <div className="avatar">노</div>
          <div>
            <strong>노유성</strong>
            <span>개인 학습 플랜</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {view === 'input' && (
          <section className="input-view">
            <div className="input-inner">
              <span className="ribbon">sand to gold</span>
              <h1>무엇을 배우고 싶나요?</h1>
              <p className="subcopy">
                주제를 입력하면 Sageum이 흩어진 웹 정보를 모아 학습 커리큘럼과 지식 노트로 정제합니다.
              </p>

              <form className="searchbox" onSubmit={handleSubmit}>
                <Search className="search-icon" size={21} />
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="예: 트랜스포머 아키텍처가 어떻게 동작하는지 처음부터 이해하고 싶어요"
                />
                <button className="btn btn-primary" type="submit">
                  커리큘럼 만들기
                  <Send size={16} />
                </button>
              </form>

              <div className="options">
                <Segment label="수준" values={['입문', '중급', '심화']} value={level} onChange={setLevel} />
                <Segment label="형식" values={['커리큘럼', '요약 노트', '치트시트']} value={format} onChange={setFormat} />
              </div>

              <div className="examples">
                <div className="examples-label">이런 주제로 시작해보세요</div>
                <div className="chips">
                  {examples.map((example) => (
                    <button className="tag" type="button" key={example} onClick={() => setTopic(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {view === 'collect' && (
          <section className="collect-view">
            <div className="collect-head">
              <span className="pill">
                <Sparkles size={13} />
                sageum agent
              </span>
              <h2>{activeTopic}</h2>
              <p>
                {level} 수준 · {format} 형식 · backend job table에 기록하고 agent callback을 기다립니다.
              </p>
            </div>

            <div className="stepper">
              {steps.map((step) => {
                const done = progress >= step.threshold + 18 || job?.status === 'completed';
                const active = progress >= step.threshold && progress < step.threshold + 18 && job?.status !== 'completed';
                return (
                  <div className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`} key={step.name}>
                    <span className="step-dot">{done && <Check size={10} />}</span>
                    <strong>{step.name}</strong>
                    <small>{step.detail}</small>
                  </div>
                );
              })}
            </div>

            <div className="progress-row">
              <span>{job?.status === 'failed' ? '실패' : progress >= 100 ? '완료' : '자료를 정제하는 중...'}</span>
              <b>{Math.round(progress)}%</b>
            </div>
            <div className="progressbar">
              <i style={{ width: `${progress}%` }} />
            </div>

            {error && (
              <div className="errorbox">
                <strong>작업 오류</strong>
                <p>{error}</p>
                <button className="btn btn-ghost" type="button" onClick={() => navigate('input')}>
                  다시 입력하기
                </button>
              </div>
            )}

            <div className="feed-label">
              <span>수집된 소스</span>
              <span>금 {displaySources.length}</span>
            </div>
            <div className="feed">
              {displaySources.map((source, index) => (
                <div className="source-row gold" key={`${source.url ?? source.title ?? index}`}>
                  <span className="grain" />
                  <div>
                    <small>{sourceDomain(source)}</small>
                    <strong>{sourceTitle(source, index)}</strong>
                  </div>
                  <span className="source-badge">금</span>
                </div>
              ))}
            </div>

            <div className="collect-actions">
              <button className="btn btn-primary" type="button" disabled={job?.status !== 'completed'} onClick={() => navigate('result')}>
                커리큘럼 보기
              </button>
            </div>
          </section>
        )}

        {view === 'result' && (
          <section className="result-view">
            <header className="topbar">
              <button className="icon-button" type="button" aria-label="메뉴">
                <Menu size={17} />
              </button>
              <span className="crumb">
                커리큘럼 / <b>{job?.topic ?? activeTopic}</b>
              </span>
              <span className="topbar-spacer" />
              <span className="pill">정제 완료</span>
              <button className="btn btn-ghost small" type="button">
                공유
              </button>
              <button className="btn btn-primary small" type="button">
                저장소에 보관
              </button>
            </header>

            <div className="result-grid">
              <nav className="toc">
                <div className="toc-head">
                  <h2>{job?.topic ?? activeTopic}</h2>
                  <p>{lessons.length}개 레슨 · agent callback 기반 결과</p>
                </div>
                {lessons.map((lesson) => (
                  <button
                    className={`lesson ${lesson.id === lessonId ? 'active' : ''}`}
                    type="button"
                    key={lesson.id}
                    onClick={() => setLessonId(lesson.id)}
                  >
                    <span className="lesson-dot" />
                    <span>{lesson.title}</span>
                    {lesson.id === lessonId && <Check size={14} />}
                  </button>
                ))}
              </nav>

              <article className="note">
                <div className="note-inner">
                  {job?.status === 'completed' && job.html ? (
                    <div className="generated-html" dangerouslySetInnerHTML={{ __html: job.html }} />
                  ) : job?.status === 'completed' && job.markdown ? (
                    <pre className="markdown-output">{job.markdown}</pre>
                  ) : (
                    <DemoLesson lesson={activeLesson} />
                  )}
                </div>
              </article>

              <aside className="source-panel">
                <div className="save-card">
                  <FileText size={18} />
                  <strong>이 레슨 학습 노트</strong>
                  <p>선별된 금 소스에서 정제된 결과를 저장합니다.</p>
                  <button className="btn btn-primary small" type="button">
                    노트 저장
                  </button>
                </div>

                <div className="panel-title">
                  참고 출처 <span>{displaySources.length}</span>
                </div>
                <div className="refs">
                  {displaySources.map((source, index) => (
                    <a className="ref" href={source.url || '#'} target="_blank" rel="noreferrer" key={`${source.url ?? source.title ?? index}`}>
                      <strong>{sourceTitle(source, index)}</strong>
                      <span>
                        {sourceDomain(source)}
                        <ExternalLink size={12} />
                      </span>
                    </a>
                  ))}
                </div>
              </aside>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Segment({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segment">
      <span>{label}</span>
      {values.map((item) => (
        <button className={item === value ? 'on' : ''} type="button" key={item} onClick={() => onChange(item)}>
          {item}
        </button>
      ))}
    </div>
  );
}

function DemoLesson({ lesson }: { lesson: (typeof lessons)[number] }) {
  return (
    <>
      <div className="kicker">{lesson.module}</div>
      <h2>{lesson.title}</h2>
      <p className="lead">{lesson.lead}</p>
      <span className="estimate">
        <Clock size={13} /> 예상 {lesson.minutes}
      </span>

      <h3>학습 흐름</h3>
      <p>
        Sageum은 검색 결과를 단순 목록으로 보여주지 않습니다. 먼저 주제의 핵심 질문을 뽑고, 신뢰할 수 있는 출처를 모은 뒤,
        사용자가 바로 따라갈 수 있는 순서로 재구성합니다.
      </p>
      <ul>
        <li>입문자는 용어와 배경지식부터 시작합니다.</li>
        <li>중급자는 비교, 사례, 구현 포인트를 먼저 봅니다.</li>
        <li>심화 학습자는 원문과 논문, 공식 문서를 함께 확인합니다.</li>
      </ul>

      <div className="viz">
        <div className="viz-bar">
          <span>flow</span>
          <strong>backend job과 agent callback</strong>
        </div>
        <div className="viz-body">
          <div className="flow">
            <span>front</span>
            <i />
            <span>back job</span>
            <i />
            <span>agent</span>
            <i />
            <span>callback</span>
          </div>
        </div>
        <p>프론트는 백엔드만 호출하고, Codex OAuth token과 agent 실행은 서버 영역에만 남습니다.</p>
      </div>

      <div className="callout">
        <Database size={16} />
        <span>완료된 결과는 TypeORM job row에 Markdown, HTML, source metadata로 저장됩니다.</span>
      </div>
    </>
  );
}
