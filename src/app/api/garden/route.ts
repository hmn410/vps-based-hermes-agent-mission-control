import { NextRequest, NextResponse } from 'next/server';

export const dynamic = "force-dynamic";

// Shared garden blob — same source as Marwa's dashboard (source of truth)
const GARDEN_BLOB = 'https://jsonblob.com/api/jsonBlob/019cce3a-7bc9-7e88-9e8f-fe461957b1aa';

export async function GET() {
  try {
    const res = await fetch(GARDEN_BLOB, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`jsonblob GET failed: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error('Garden GET error:', e);
    return NextResponse.json({ error: 'Failed to fetch garden' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(GARDEN_BLOB, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`jsonblob PUT failed: ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Garden PUT error:', e);
    return NextResponse.json({ error: 'Failed to update garden' }, { status: 500 });
  }
}
