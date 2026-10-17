import { NextRequest, NextResponse } from "next/server";

const TARGET_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://127.0.0.1:8001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Forward the request to the backend API
    const response = await fetch(`${TARGET_SERVER_BASE_URL}/auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend server returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.warn('Backend auth request failed:', error);
    return NextResponse.json(
      { error: 'Cannot reach the Python backend. Start the full application with npm start and check .local/logs/api-error.log.' },
      { status: 503 }
    );
  }
}
