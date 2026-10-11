import { useEffect, useRef, useState } from 'react';
import type { Result } from '../shared/contracts';
import type { ChatStatus } from '../shared/chat';
import type { SourceSelection } from './SourceViewer';

export function ChatPanel({ chat, repoId, commit, act, onSource, onSettings, draft, active }: { chat?: ChatStatus; repoId?: string; commit?: string; onSource: (source: SourceSelection) => void; onSettings: () => void; draft?: { question: string; sequence: number }; active: boolean; act: (action: () => Promise<Result>) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const requests = useRef(0);
  const running = chat?.phase === 'retrieving' || chat?.phase === 'answering';
  useEffect(() => { requests.current++; setError(''); }, [repoId, chat?.answers.length]);
  useEffect(() => { if (draft) setQuestion(draft.question); }, [draft]);
  useEffect(() => { setQuestion(''); setSubmitted(''); follow.current = true; }, [repoId]);
  useEffect(() => { if (active && follow.current && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight; }, [active, chat?.answers.length, chat?.phase]);
  useEffect(() => { if (active && draft) document.getElementById('repo-question')?.focus(); }, [active, draft]);
  async function citation(id: string, commit: string, section: number, claim: number, citation: number) {
    const request = ++requests.current; setError('');
    const result = await window.desktop.chatCitation(id, section, claim, citation);
    if (request !== requests.current) return;
    if (result.ok && result.source) onSource({ evidence: result.source, commit, origin: 'chat' }); else if (!result.ok) setError(result.error.message);
  }
  return <section className="chat-workspace" aria-labelledby="chat-title">
    <div className="chat-toolbar"><div><h2 id="chat-title">Repository chat</h2><span className="muted">{commit ? `Committed source · ${commit.slice(0, 12)}` : 'Connect a repository to begin'}</span></div><div className="chat-tools"><span className="status" data-testid="chat-state">{chat?.phase ?? 'idle'}</span><button type="button" onClick={onSettings}>Model settings</button><button type="button" onClick={() => { setSubmitted(''); void act(() => window.desktop.clearChat()); }}>New conversation</button></div></div>
    <div className="chat-history" ref={historyRef} role="log" aria-label="Conversation" aria-live="polite" onScroll={() => { const el = historyRef.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>{!chat?.answers.length && <div className="empty-state"><h3>Ask your codebase</h3><p>Documentation is optional. Ask about a function, a workflow, or an edge case; answers link back to committed source.</p></div>}{chat?.answers.map(answer => <article className="chat-answer" key={answer.id}>
      <div className="chat-user"><span className="message-label">YOU</span><h3>{answer.question}</h3></div><span className="message-label assistant-label">ASSISTANT</span><details className="answer-meta"><summary>Answer details{answer.cached ? ' · cached' : ''}</summary><p className="muted"><code>{answer.commit.slice(0, 12)}</code> · {answer.provider === 'openrouter' ? 'OpenRouter' : 'Ollama'} · {answer.mode === 'direct' ? 'Direct structural lookup' : answer.mode === 'model' ? answer.servedModel || answer.model : 'Insufficient evidence'} · {answer.cached ? 'Verified cache hit; no new request' : answer.cost === null ? 'Cost unknown' : `Reported cost $${answer.cost.toFixed(4)}`}{answer.commit !== commit && <strong className="stale"> · Older commit</strong>}</p></details>
      <div className="retrieval-trail" aria-label="Retrieval sources">
        <span>{answer.documentStatus === 'unavailable' ? 'Document not found for this commit' : answer.documentStatus === 'no-match' ? 'No matching document' : answer.documentStatus === 'not-needed' ? 'Document lookup not needed' : answer.documentStatus === 'matched' ? 'Document matches found' : 'Document status unavailable'}</span>
        <span aria-hidden="true">→</span><span>{answer.quality.sources.some(source => source.kg) ? 'KG-guided codebase' : 'Codebase'} · {answer.evidence.length} excerpts</span>
      </div>
      {answer.content?.sections.map((section, si) => <section key={si}><h4>{section.title}</h4>{section.claims.map((claim, ci) => <div key={ci}><p><span className="claim-basis">{answer.mode === 'direct' ? 'extracted location' : claim.basis}</span> {claim.text}</p><div className="citation-links">{claim.citations.map((item, ei) => <button className="text-button" key={ei} onClick={() => void citation(answer.id, answer.commit, si, ci, ei)}>{answer.evidence.find(e => e.id === item.evidenceId)?.path}:{item.start}–{item.end}</button>)}</div></div>)}</section>)}
      <details><summary>Evidence and limitations · {answer.route}{answer.expanded ? ' · expanded once' : ''}</summary><p>{answer.evidence.length} source excerpts; {answer.documents} documentation source candidates. Reference checks do not prove the model’s interpretation.</p><ul>{[...answer.gaps, ...(answer.content?.gaps ?? [])].map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>
      {answer.mode === 'insufficient' && <p>No supported answer is available. Name an exact file or symbol and try again.</p>}
      <div className="answer-quality" aria-label="Answer confidence and data used">
        <strong>Confidence: {answer.quality.score}/100 <span className="muted">· evidence estimate</span></strong>
        <p className="data-used">Data used: {answer.quality.sources.length ? <>{answer.quality.sources.some(source => source.document) && <span>Document</span>}{answer.quality.sources.some(source => source.codebase) && <span>Codebase</span>}{answer.quality.sources.some(source => source.kg) && <span>KG</span>}</> : <span>None</span>}</p>
        <details><summary>Score and source details</summary><p>Heuristic score, not a probability of correctness. Verified quotes do not prove an interpretation.</p><ul>{answer.quality.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><ul>{answer.quality.sources.map(source => <li key={source.evidenceId}>{source.path}:{source.start}–{source.end} · Codebase{source.document ? ' · Document-guided source' : ''}{source.kg ? ' · KG-guided source (unresolved calls)' : ''}</li>)}</ul><p>Document and KG labels mean they helped retrieve the retained source excerpts. Generated document claims and graph previews are not used as authoritative evidence.</p></details>
      </div>
    </article>)}
      {running && <div className="chat-pending"><div className="chat-user">{submitted}</div><p className="muted">{chat?.retrievalNote}</p><p role="status">{chat?.phase === 'retrieving' ? 'Finding committed evidence…' : 'Generating a cited answer…'}</p></div>}
      {chat?.error && <p role="alert" className="error">{chat.error}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); if (!commit || running || !question.trim()) return; const value = question; setSubmitted(value); follow.current = true; void act(async () => { const result = await window.desktop.askQuestion(value); if (result.ok) setQuestion(''); return result; }); }}>
      <label htmlFor="repo-question">Repository question</label>
      <textarea id="repo-question" rows={2} maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={commit ? 'Ask about a file, symbol or workflow…' : 'Connect a repository and wait for its first snapshot…'} disabled={running} />
      <div className="composer-actions"><span className="muted">Enter to send · Shift+Enter for a new line</span>{running ? <button type="button" onClick={() => void act(() => window.desktop.cancelQuestion())}>Stop answer</button> : <button className="primary" disabled={!commit || !question.trim()} type="submit">Ask repository</button>}</div>
      <details className="chat-help"><summary>Evidence, privacy and request limits</summary><p>Answers cite a fixed commit. Up to three earlier same-commit questions provide context. Exact lookups and cache hits run locally; explanations send bounded questions/source to the selected provider (Ollama locally or OpenRouter remotely) using your saved model and shared budget (at most two requests). Secret filtering is best effort. Chat pauses documentation; resume it explicitly.</p></details>
    </form>
  </section>;
}
