import { backendBase } from '@/utils/backend';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  // Next may normalize nextUrl to localhost even when the browser uses 127.0.0.1.
  // Compare the actual request host and still restrict review to local origins.
  const localOrigins = ['http://127.0.0.1:3000', 'http://localhost:3000'];
  if (!origin || !localOrigins.includes(origin) || new URL(origin).host !== req.headers.get('host') ||
      req.headers.get('x-deepwiki-review') !== '1') {
    return NextResponse.json({ detail: 'Use the local review interface' }, { status: 403 });
  }
  try {
    const { action, proposal_id, request } = await req.json();
    if (!['propose', 'get', 'accept', 'reject'].includes(action) ||
        (action !== 'propose' && !/^[a-f0-9]{32}$/.test(proposal_id))) {
      return NextResponse.json({ detail: 'Invalid review request' }, { status: 400 });
    }
    const base = backendBase();
    const suffix = action === 'propose' ? '' : `/${proposal_id}${action === 'get' ? '' : `/${action}`}`;
    const response = await fetch(`${base}/chat/changes${suffix}`, {
      method: action === 'get' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DeepWiki-Review': '1', Origin: origin },
      body: action === 'propose' ? JSON.stringify(request) : undefined,
      cache: 'no-store',
    });
    return new NextResponse(await response.text(), {
      status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ detail: 'Review service unavailable. Your proposal is preserved; retry to check its status.' }, { status: 502 });
  }
}
