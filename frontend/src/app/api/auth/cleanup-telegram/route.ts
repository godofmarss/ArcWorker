import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: Request) {
    try {
        const { secret } = await request.json();
        if (secret !== 'arcworker-cleanup-2025') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await sql`DELETE FROM users WHERE email LIKE 'tg_%@telegram.arcworker'`;

        return NextResponse.json({ success: true, message: 'Telegram test accounts deleted' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
