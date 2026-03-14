import { NextResponse } from 'next/server';
import { createCircleEmailSession } from '@/arcworker-sdk/wallet/server';
import crypto from 'crypto';

export async function POST(request: Request) {
    try {
        const { email, deviceId } = await request.json();
        if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

        const session = await createCircleEmailSession(
            email,
            deviceId || crypto.randomUUID()
        );

        return NextResponse.json({ success: true, ...session });
    } catch (error: any) {
        console.error('[Circle ReAuth] Error:', error.response?.data || error.message);
        return NextResponse.json({ error: 'Failed to initiate re-auth' }, { status: 500 });
    }
}
