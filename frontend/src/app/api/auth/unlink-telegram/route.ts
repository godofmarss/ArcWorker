import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: Request) {
    try {
        const { secret, email } = await request.json();
        if (secret !== 'arcworker-unlink-2025') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        await sql`UPDATE users SET telegram_id = NULL, telegram_wallet_address = NULL WHERE email = ${email.toLowerCase()}`;
        return NextResponse.json({ success: true, message: 'Telegram unlinked' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
