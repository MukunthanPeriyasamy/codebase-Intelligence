export default function EmbeddingModelField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="my-4 block text-sm text-[var(--foreground)]">
    <span className="mb-2 block font-medium">Ollama embedding model</span>
    <input aria-label="Ollama embedding model" value={value} onChange={event => onChange(event.target.value)} placeholder="nomic-embed-text"
      className="w-full rounded border border-[var(--border-color)] bg-[var(--background)] p-2" />
    <span className="mt-1 block text-xs text-[var(--muted)]">Used to index and search generated documents in ChromaDB. The model must be installed on the backend’s Ollama server. This is separate from the answer model.</span>
  </label>;
}
