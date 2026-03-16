import { NextResponse } from 'next/server';
import { getUserIdFromToken } from '@/arcworker-sdk/wallet/server';

export async function POST(request: Request) {
    const { userToken } = await request.json();
    const userId = await getUserIdFromToken(userToken);
    return NextResponse.json({ userId });
}
