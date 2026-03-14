import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: Request) {
    try {
        const { secret } = await request.json();
        if (secret !== 'arcworker-migrate-2025') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Add telegram_id column
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(50)`;
        
        // Add otp columns
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10)`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_wallet_address VARCHAR(100)`;

        return NextResponse.json({ success: true, message: 'Migration complete' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
