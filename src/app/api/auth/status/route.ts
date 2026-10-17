import { backendBase } from '@/utils/backend';
import { NextResponse } from "next/server";

const TARGET_SERVER_BASE_URL = backendBase();

export async function GET() {
  try {
    // Forward the request to the backend API
    const response = await fetch(`${TARGET_SERVER_BASE_URL}/auth/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
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
