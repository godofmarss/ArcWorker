import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: Request) {
    try {
        const { secret, email, telegramWalletAddress } = await request.json();
        if (secret !== 'arcworker-fix-2025') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        await sql`UPDATE users SET telegram_wallet_address = ${telegramWalletAddress} WHERE email = ${email.toLowerCase()}`;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
