import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: Request) {
    try {
        const { telegramId } = await request.json();
        const result = await sql`
            SELECT wallet_address, wallet_type, telegram_wallet_address, username
            FROM users WHERE telegram_id = ${String(telegramId)}
        `;
        if (result.rows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        const user = result.rows[0];
        return NextResponse.json({
            walletAddress: user.telegram_wallet_address || user.wallet_address,
            walletType: user.wallet_type,
            username: user.username
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
