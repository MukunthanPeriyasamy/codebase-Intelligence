import Markdown from './Markdown';

export default function ChatAnswer({ content }: { content: string }) {
  const marker = '\n\nRetrieved document sources:\n';
  const position = content.lastIndexOf(marker);
  if (position < 0) return <Markdown content={content} allowHtml={false} />;
  const references = content.slice(position + marker.length).split('\n').filter(Boolean);
  return <>
    <Markdown content={content.slice(0, position)} allowHtml={false} />
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer">Source references ({references.length})</summary>
      <ul className="mt-2 space-y-2">{references.map((reference, index) => {
        const match = reference.match(/ \| retrieval-score:(\d{1,3})%$/);
        return <li key={index}>{match ? reference.slice(0, match.index) : reference}{match && <span className="ml-2 text-[11px] text-green-600 dark:text-green-400" title="Retrieval similarity (cosine), not a calibrated probability of correctness">{match[1]}%</span>}</li>;
      })}</ul>
    </details>
  </>;
}
