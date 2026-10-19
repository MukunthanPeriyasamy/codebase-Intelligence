import { NextRequest, NextResponse } from 'next/server';
import { backendBase } from '@/utils/backend';

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin || !['http://127.0.0.1:3000', 'http://localhost:3000'].includes(origin) ||
      new URL(origin).host !== req.headers.get('host') || req.headers.get('x-deepwiki-review') !== '1') {
    return NextResponse.json({ detail: 'Use the local KG chat interface' }, { status: 403 });
  }
  try {
    const { action, ...body } = await req.json();
    if (!['tools', 'call', 'ask'].includes(action)) return NextResponse.json({ detail: 'Unknown action' }, { status: 400 });
    const response = await fetch(`${backendBase()}/kg/${action}`, {
      method: action === 'tools' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DeepWiki-Review': '1', Origin: origin },
      body: action !== 'tools' ? JSON.stringify(body) : undefined,
      cache: 'no-store', signal: AbortSignal.timeout(action === 'ask' ? 300000 : 100000),
    });
    return new NextResponse(await response.text(), { status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ detail: 'KG service unavailable or timed out. Check its status before repeating an operation.' }, { status: 502 });
  }
}
